#!/usr/bin/env python3
"""Serve Fareless locally and provide live priced sweeps through Fli."""

from __future__ import annotations

import argparse
import base64
import concurrent.futures
import html
import io
import json
import os
import posixpath
import re
import time
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlencode, urlparse

try:
  from fli.core import build_date_search_segments, build_flight_segments
  from fli.core.parsers import parse_airlines, parse_cabin_class, parse_max_stops, resolve_airport
  from fli.models.airline import AIRLINE_NAMES
  from fli.models import DateSearchFilters, FlightSearchFilters, PassengerInfo, SortBy
  from fli.search import SearchDates, SearchFlights
except ImportError:
  build_date_search_segments = None
  build_flight_segments = None
  parse_airlines = None
  parse_cabin_class = None
  parse_max_stops = None
  resolve_airport = None
  AIRLINE_NAMES = {}
  DateSearchFilters = None
  FlightSearchFilters = None
  PassengerInfo = None
  SearchDates = None
  SearchFlights = None
  SortBy = None


ROOT = Path(__file__).resolve().parent
MAX_BODY_BYTES = 2 * 1024 * 1024
TOP_DEAL_LIMIT = 4
MAX_ENRICHED_FARE_OPTIONS_PER_BUCKET = 5
MAX_FLI_QUERIES_PER_MONITOR = 80
MAX_FLI_CONCURRENT_QUERIES = max(1, int(os.environ.get("MAX_FLI_CONCURRENT_QUERIES", "2")))
MAX_PAIRS_PER_MONITOR = 12
MAX_EXCLUDED_AIRLINES = 24
MAX_SHARE_PARAM_CHARS = 12000
AIRLINE_PLACEHOLDER = "Check Google Flights for airline"
SWEEP_CACHE_TTL_SECONDS = int(os.environ.get("SWEEP_CACHE_TTL_SECONDS", str(6 * 60 * 60)))
RATE_WINDOW_SECONDS = int(os.environ.get("RATE_WINDOW_SECONDS", "3600"))
MAX_SWEEPS_PER_CLIENT_WINDOW = int(os.environ.get("MAX_SWEEPS_PER_CLIENT_WINDOW", "12"))
MAX_SWEEPS_PER_IP_WINDOW = int(os.environ.get("MAX_SWEEPS_PER_IP_WINDOW", "30"))
rate_limit_hits: dict[str, list[float]] = {}
sweep_cache: dict[str, dict] = {}
search_query_cache: dict[str, dict] = {}
flight_detail_cache: dict[str, dict] = {}
PUBLIC_STATIC_PATHS = {
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/travel-windows.js",
}
PUBLIC_STATIC_PREFIXES = ("/assets/",)
PUBLIC_ASSET_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".svg"}


def fli_available() -> bool:
  return all((
    build_date_search_segments,
    build_flight_segments,
    parse_airlines,
    parse_cabin_class,
    parse_max_stops,
    resolve_airport,
    DateSearchFilters,
    FlightSearchFilters,
    PassengerInfo,
    SearchDates,
    SearchFlights,
    SortBy,
  ))


def sweep_monitor(monitor: dict) -> dict:
  if not fli_available():
    raise RuntimeError("Live fare lookup requires the `flights` package. Run `.venv/bin/python server.py --port 8001` or install it with `python -m pip install flights`.")

  normalized = normalize_monitor(monitor)
  cache_key = sweep_cache_key(normalized)
  cached = read_cache(sweep_cache, cache_key)
  if cached:
    cached["cacheStatus"] = "hit"
    return cached

  candidates: list[dict] = []
  provider_errors: list[str] = []
  query_count = 0

  search_jobs, skipped_jobs = build_search_jobs(normalized)
  if skipped_jobs:
    provider_errors.append(f"Skipped {skipped_jobs} fare {pluralize(skipped_jobs, 'search', 'searches')} to stay under the {MAX_FLI_QUERIES_PER_MONITOR}-query limit.")

  if MAX_FLI_CONCURRENT_QUERIES <= 1 or len(search_jobs) <= 1:
    for pair, duration in search_jobs:
      try:
        trips, used_queries = run_search_job(pair, normalized, duration)
        candidates.extend(trips)
        query_count += used_queries
      except Exception as error:
        provider_errors.append(f"{format_route(pair)} / {duration} days: {short_error(error)}")
  else:
    with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_FLI_CONCURRENT_QUERIES) as executor:
      future_to_job = {
        executor.submit(run_search_job, pair, normalized, duration): (pair, duration)
        for pair, duration in search_jobs
      }
      for future in concurrent.futures.as_completed(future_to_job):
        pair, duration = future_to_job[future]
        try:
          trips, used_queries = future.result()
          candidates.extend(trips)
          query_count += used_queries
        except Exception as error:
          provider_errors.append(f"{format_route(pair)} / {duration} days: {short_error(error)}")

  if not candidates and provider_errors:
    raise RuntimeError("; ".join(provider_errors[:3]))

  candidates.sort(key=deal_sort_key)
  curated_deals = curate_top_deals(candidates, TOP_DEAL_LIMIT)
  top_deals, enrichment_queries = enrich_deal_airlines(curated_deals, normalized)
  prices = [deal["price"] for deal in candidates if isinstance(deal.get("price"), (int, float))]
  average_price = round(sum(prices) / len(prices), 2) if prices else 0

  result = {
    "provider": "fli",
    "ranAt": datetime.now(timezone.utc).isoformat(),
    "averagePrice": average_price,
    "topDeals": top_deals,
    "candidateCount": len(candidates),
    "combinationCount": normalized["combination_count"],
    "liveQueryCount": query_count + enrichment_queries,
    "cacheStatus": "miss",
    "providerErrors": provider_errors[:6],
  }
  write_cache(sweep_cache, cache_key, result, SWEEP_CACHE_TTL_SECONDS)
  return result


def build_search_jobs(monitor: dict) -> tuple[list[tuple[dict, int]], int]:
  jobs = []
  planned_queries = 0
  skipped_jobs = 0
  date_count = len(enumerate_dates(monitor["start_from"], monitor["start_to"]))
  for pair in monitor["pairs"]:
    for duration in range(monitor["trip_min"], monitor["trip_max"] + 1):
      estimated_queries = date_count if duration == 0 else 1
      if planned_queries + estimated_queries > MAX_FLI_QUERIES_PER_MONITOR:
        skipped_jobs += 1
        continue
      jobs.append((pair, duration))
      planned_queries += estimated_queries
  return jobs, skipped_jobs


def run_search_job(pair: dict, monitor: dict, duration: int) -> tuple[list[dict], int]:
  if duration == 0:
    return search_same_day_flights(pair, monitor)
  return search_flexible_dates(pair, monitor, duration)


def airline_filter_kwargs(monitor: dict) -> dict:
  airlines = parse_airlines(monitor["excluded_airlines"])
  if not airlines:
    return {}
  if monitor.get("airline_mode") == "include":
    return {"airlines": airlines}
  return {"airlines_exclude": airlines}


def normalize_monitor(monitor: dict) -> dict:
  if not isinstance(monitor, dict):
    raise ValueError("Monitor payload must be an object")

  pairs = []
  seen_pairs = set()
  for pair in monitor.get("pairs") or []:
    if len(pairs) >= MAX_PAIRS_PER_MONITOR:
      break
    origin = clean_iata(pair.get("origin"))
    destination = clean_iata(pair.get("destination"))
    key = (origin, destination)
    if origin and destination and origin != destination and key not in seen_pairs:
      pairs.append({"origin": origin, "destination": destination})
      seen_pairs.add(key)
  if not pairs:
    raise ValueError("Add at least one airport pair before finding fares")

  start_from = parse_date(monitor.get("startFrom"), "startFrom")
  start_to = parse_date(monitor.get("startTo"), "startTo")
  if start_from > start_to:
    start_from, start_to = start_to, start_from

  max_possible_duration = max(0, (start_to - start_from).days)
  trip_min = clamp_days(monitor.get("tripMin"), max_possible_duration)
  trip_max = clamp_days(monitor.get("tripMax"), max_possible_duration)
  trip_min, trip_max = min(trip_min, trip_max), max(trip_min, trip_max)

  excluded_airlines = sorted({
    clean_airline_code(code)
    for code in (monitor.get("excludedAirlines") or [])
    if clean_airline_code(code)
  })[:MAX_EXCLUDED_AIRLINES]
  airline_mode = "include" if monitor.get("airlineMode") == "include" else "exclude"
  max_stops = normalize_max_stops(monitor.get("maxStops", 0))

  return {
    "pairs": pairs,
    "start_from": start_from.isoformat(),
    "start_to": start_to.isoformat(),
    "trip_min": trip_min,
    "trip_max": trip_max,
    "max_stops": max_stops,
    "excluded_airlines": excluded_airlines,
    "airline_mode": airline_mode,
    "combination_count": count_combinations(pairs, start_from, start_to, trip_min, trip_max),
  }


def search_flexible_dates(pair: dict, monitor: dict, duration: int) -> tuple[list[dict], int]:
  cache_key = search_query_cache_key(pair, monitor, duration, "dates")
  cached = read_cache(search_query_cache, cache_key)
  if cached is not None:
    return cached, 0

  origin = resolve_airport(pair["origin"])
  destination = resolve_airport(pair["destination"])
  segments, trip_type = build_date_search_segments(
    origin=origin,
    destination=destination,
    start_date=monitor["start_from"],
    trip_duration=duration,
    is_round_trip=True,
  )
  filters = DateSearchFilters(
    trip_type=trip_type,
    passenger_info=PassengerInfo(adults=1),
    flight_segments=segments,
    stops=parse_max_stops(monitor["max_stops"]),
    seat_type=parse_cabin_class("ECONOMY"),
    **airline_filter_kwargs(monitor),
    from_date=monitor["start_from"],
    to_date=monitor["start_to"],
    duration=duration,
  )
  results = SearchDates().search(filters, currency="USD", language="en-US", country="US") or []
  deals = [
    deal_from_date_price(pair, result)
    for result in results
    if date_price_matches(result, monitor, duration)
  ]
  for deal in deals:
    deal["maxStops"] = monitor["max_stops"]
  write_cache(search_query_cache, cache_key, deals, SWEEP_CACHE_TTL_SECONDS)
  return deals, 1


def search_same_day_flights(pair: dict, monitor: dict) -> tuple[list[dict], int]:
  cache_key = search_query_cache_key(pair, monitor, 0, "same-day")
  cached = read_cache(search_query_cache, cache_key)
  if cached is not None:
    return cached, 0

  deals = []
  query_count = 0
  excluded = set(monitor["excluded_airlines"] if monitor.get("airline_mode") == "exclude" else [])
  for depart in enumerate_dates(monitor["start_from"], monitor["start_to"]):
    origin = resolve_airport(pair["origin"])
    destination = resolve_airport(pair["destination"])
    segments, trip_type = build_flight_segments(
      origin=origin,
      destination=destination,
      departure_date=depart.isoformat(),
      return_date=depart.isoformat(),
    )
    filters = FlightSearchFilters(
      trip_type=trip_type,
      passenger_info=PassengerInfo(adults=1),
      flight_segments=segments,
      stops=parse_max_stops(monitor["max_stops"]),
      seat_type=parse_cabin_class("ECONOMY"),
      **airline_filter_kwargs(monitor),
      sort_by=SortBy.CHEAPEST,
    )
    results = SearchFlights().search(filters, top_n=3, currency="USD", language="en-US", country="US") or []
    query_count += 1
    deals.extend(
      deal
      for deal in (flight_result_to_deal(pair, result, depart.isoformat(), depart.isoformat(), excluded) for result in results)
      if deal
    )
  for deal in deals:
    deal["maxStops"] = monitor["max_stops"]
  write_cache(search_query_cache, cache_key, deals, SWEEP_CACHE_TTL_SECONDS)
  return deals, query_count


def deal_from_date_price(pair: dict, result: object) -> dict:
  depart_dt, return_dt = result.date
  depart = depart_dt.date().isoformat()
  return_date = return_dt.date().isoformat()
  return {
    "route": format_route(pair),
    "origin": pair["origin"],
    "destination": pair["destination"],
    "depart": depart,
    "returnDate": return_date,
    "length": (return_dt.date() - depart_dt.date()).days,
    "price": round_price(result.price),
    "currency": getattr(result, "currency", None) or "USD",
    "sourceName": "Google Flights",
    "sourceUrl": google_flights_url(pair["origin"], pair["destination"], depart, return_date),
    "provider": "fli",
  }


def flight_result_to_deal(pair: dict, result: object, depart: str, return_date: str, excluded: set[str]) -> dict | None:
  flights = result if isinstance(result, tuple) else (result,)
  prices = [flight.price for flight in flights if getattr(flight, "price", None) is not None]
  if not prices:
    return None

  airline_codes = []
  airline_names = []
  for flight in flights:
    collect_primary_airline(flight, airline_codes, airline_names)
    collect_airlines(flight, airline_codes, airline_names)
  if excluded and any(code in excluded for code in airline_codes):
    return None

  return {
    "route": format_route(pair),
    "origin": pair["origin"],
    "destination": pair["destination"],
    "depart": depart,
    "returnDate": return_date,
    "length": 0,
    "price": round_price(min(prices)),
    "currency": "USD",
    "airlineCode": ", ".join(unique_values(airline_codes)),
    "airlineName": format_airline_names(airline_names),
    "stopCount": stop_count_from_flights(flights),
    "flightMinutes": flight_duration_minutes(flights),
    "sourceName": "Google Flights",
    "sourceUrl": google_flights_url(pair["origin"], pair["destination"], depart, return_date),
    "provider": "fli",
  }


def enrich_deal_airlines(deals: list[dict], monitor: dict) -> tuple[list[dict], int]:
  enriched = []
  query_count = 0
  for deal in deals:
    if deal.get("fareOptions"):
      next_deal, used_queries = enrich_fare_bucket_airlines(deal, monitor)
      enriched.append(next_deal)
      query_count += used_queries
      continue
    if has_real_airline(deal):
      enriched.append(deal)
      continue
    try:
      next_deal, used_query = enrich_single_deal_airline(deal, monitor)
      enriched.append(next_deal)
      query_count += used_query
    except Exception:
      deal["airlineName"] = best_available_airline_label(deal)
      enriched.append(deal)
  return enriched, query_count


def enrich_fare_bucket_airlines(deal: dict, monitor: dict) -> tuple[dict, int]:
  next_deal = dict(deal)
  options = []
  query_count = 0
  for index, option in enumerate(deal.get("fareOptions") or []):
    next_option = dict(option)
    if index < MAX_ENRICHED_FARE_OPTIONS_PER_BUCKET and not has_real_airline(next_option):
      try:
        next_option, used_query = enrich_single_deal_airline(next_option, monitor)
        query_count += used_query
      except Exception:
        next_option["airlineName"] = best_available_airline_label(next_option)
    options.append(next_option)

  propagate_known_airlines(options)
  next_deal["fareOptions"] = [compact_related_deal(option) for option in options]
  apply_fare_bucket_airline_summary(next_deal, options)
  return next_deal, query_count


def propagate_known_airlines(options: list[dict]) -> None:
  known_by_trip = {
    deal_identity(option): {
      "airlineCode": option.get("airlineCode", ""),
      "airlineName": best_available_airline_label(option),
      "stopCount": option.get("stopCount"),
      "flightMinutes": option.get("flightMinutes"),
    }
    for option in options
    if has_real_airline(option) or option.get("airlineCode")
  }
  for option in options:
    if has_real_airline(option):
      continue
    known = known_by_trip.get(deal_identity(option))
    if not known:
      continue
    option["airlineCode"] = known.get("airlineCode", "")
    option["airlineName"] = known.get("airlineName", "")
    if option.get("stopCount") is None:
      option["stopCount"] = known.get("stopCount")
    if option.get("flightMinutes") is None:
      option["flightMinutes"] = known.get("flightMinutes")


def apply_fare_bucket_airline_summary(deal: dict, options: list[dict]) -> None:
  airlines = unique_values([
    best_available_airline_label(option)
    for option in options
    if has_real_airline(option) or option.get("airlineCode")
  ])
  airlines = [airline for airline in airlines if airline and airline != AIRLINE_PLACEHOLDER]
  if len(airlines) == 1:
    deal["airlineName"] = airlines[0]
    matching_option = next((option for option in options if best_available_airline_label(option) == airlines[0]), {})
    deal["airlineCode"] = matching_option.get("airlineCode", "")
  elif len(airlines) > 1:
    deal["airlineName"] = f"{len(airlines)} airlines"
    deal["airlineCode"] = ""
  else:
    deal["airlineName"] = ""
    deal["airlineCode"] = ""


def enrich_single_deal_airline(deal: dict, monitor: dict) -> tuple[dict, int]:
  excluded = set(monitor["excluded_airlines"] if monitor.get("airline_mode") == "exclude" else [])
  cache_key = flight_detail_cache_key(deal, monitor)
  cached = read_cache(flight_detail_cache, cache_key)
  if cached:
    deal.update(cached)
    return deal, 0

  origin = resolve_airport(deal["origin"])
  destination = resolve_airport(deal["destination"])
  segments, trip_type = build_flight_segments(
    origin=origin,
    destination=destination,
    departure_date=deal["depart"],
    return_date=deal["returnDate"],
  )
  filters = FlightSearchFilters(
    trip_type=trip_type,
    passenger_info=PassengerInfo(adults=1),
    flight_segments=segments,
    stops=parse_max_stops(monitor["max_stops"]),
    seat_type=parse_cabin_class("ECONOMY"),
    **airline_filter_kwargs(monitor),
    sort_by=SortBy.CHEAPEST,
  )
  results = SearchFlights().search(filters, top_n=5, currency="USD", language="en-US", country="US") or []
  best = None
  for result in results:
    candidate = flight_result_to_deal(deal, result, deal["depart"], deal["returnDate"], excluded)
    if not candidate:
      continue
    if best is None or abs(candidate["price"] - deal["price"]) < abs(best["price"] - deal["price"]):
      best = candidate
  if best:
    deal["airlineCode"] = best.get("airlineCode", "")
    deal["airlineName"] = best_available_airline_label(best)
    deal["stopCount"] = best.get("stopCount")
    deal["flightMinutes"] = best.get("flightMinutes")
  else:
    deal["airlineName"] = best_available_airline_label(deal)
  if best:
    write_cache(
      flight_detail_cache,
      cache_key,
      {
        "airlineCode": deal.get("airlineCode", ""),
        "airlineName": deal.get("airlineName", ""),
        "stopCount": deal.get("stopCount"),
        "flightMinutes": deal.get("flightMinutes"),
      },
      SWEEP_CACHE_TTL_SECONDS,
    )
  return deal, 1


def flight_duration_minutes(flights: tuple) -> int | None:
  durations = []
  for flight in flights:
    duration = getattr(flight, "duration", None)
    if isinstance(duration, (int, float)) and duration > 0:
      durations.append(int(duration))
      continue
    leg_durations = [
      getattr(leg, "duration", None)
      for leg in (getattr(flight, "legs", []) or [])
    ]
    leg_durations = [int(value) for value in leg_durations if isinstance(value, (int, float)) and value > 0]
    if leg_durations:
      durations.append(sum(leg_durations))
  return sum(durations) if durations else None


def stop_count_from_flights(flights: tuple) -> int | None:
  counts = []
  for flight in flights:
    stops = getattr(flight, "stops", None)
    if isinstance(stops, int):
      counts.append(max(0, stops))
      continue
    legs = getattr(flight, "legs", None)
    if legs is None:
      continue
    try:
      counts.append(max(0, len(legs) - 1))
    except TypeError:
      counts.append(max(0, len(list(legs)) - 1))
  return max(counts) if counts else None


def collect_primary_airline(flight: object, airline_codes: list[str], airline_names: list[str]) -> None:
  primary = getattr(flight, "primary_airline", None)
  code, name = airline_code_and_name(primary)
  if code:
    airline_codes.append(code)
  primary_name = getattr(flight, "primary_airline_name", None)
  if primary_name:
    airline_names.append(str(primary_name))
  elif name:
    airline_names.append(name)


def collect_airlines(flight: object, airline_codes: list[str], airline_names: list[str]) -> None:
  for leg in getattr(flight, "legs", []) or []:
    airline = getattr(leg, "airline", None)
    code, name = airline_code_and_name(airline)
    if code:
      airline_codes.append(code)
    if name:
      airline_names.append(name)
    operating_airline = getattr(leg, "operating_airline", None)
    operating_code, operating_name = airline_code_and_name(operating_airline)
    if operating_code:
      airline_codes.append(operating_code)
    if operating_name:
      airline_names.append(operating_name)


def airline_code_and_name(airline: object) -> tuple[str, str]:
  if not airline:
    return "", ""
  raw_code = getattr(airline, "name", "") or ""
  code = str(raw_code).removeprefix("_").upper()
  enum_value = getattr(airline, "value", None)
  name = str(enum_value) if enum_value and str(enum_value) != code else ""
  if not name and code:
    name = AIRLINE_NAMES.get(code, "")
  return code, name


def has_real_airline(deal: dict) -> bool:
  name = str(deal.get("airlineName") or "").strip()
  return bool(name and name != AIRLINE_PLACEHOLDER)


def best_available_airline_label(deal: dict) -> str:
  name = str(deal.get("airlineName") or "").strip()
  if name and name != AIRLINE_PLACEHOLDER:
    return format_airline_names(name.split(","))
  code = str(deal.get("airlineCode") or "").strip()
  if code:
    return format_airline_names([AIRLINE_NAMES.get(part.strip(), part.strip()) for part in code.split(",") if part.strip()]) or code
  return AIRLINE_PLACEHOLDER


def format_airline_names(names: list[str]) -> str:
  compacted = compact_airline_names(unique_values([str(name or "").strip() for name in names]))
  return ", ".join(compacted) or AIRLINE_PLACEHOLDER


def compact_airline_names(names: list[str]) -> list[str]:
  output = []
  for name in names:
    if not name:
      continue
    if any(airline_names_match(name, existing) for existing in output):
      output = [preferred_airline_name(existing, name) if airline_names_match(name, existing) else existing for existing in output]
      continue
    output.append(name)
  return output


def airline_names_match(first: str, second: str) -> bool:
  first_key = airline_name_key(first)
  second_key = airline_name_key(second)
  return bool(first_key and first_key == second_key)


def airline_name_key(name: str) -> str:
  key = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
  words = [word for word in key.split() if word not in {"air", "airline", "airlines", "airways", "lines"}]
  return " ".join(words)


def preferred_airline_name(first: str, second: str) -> str:
  return first if len(first) <= len(second) else second


def date_price_matches(result: object, monitor: dict, duration: int) -> bool:
  if not getattr(result, "price", None):
    return False
  depart_dt, return_dt = result.date
  depart = depart_dt.date()
  return_date = return_dt.date()
  start_from = parse_date(monitor["start_from"], "start_from")
  start_to = parse_date(monitor["start_to"], "start_to")
  return start_from <= depart <= start_to and return_date <= start_to and (return_date - depart).days == duration


def count_combinations(pairs: list[dict], start_from: date, start_to: date, trip_min: int, trip_max: int) -> int:
  count = 0
  for _pair in pairs:
    for depart in enumerate_dates(start_from.isoformat(), start_to.isoformat()):
      for duration in range(trip_min, trip_max + 1):
        if depart + timedelta(days=duration) <= start_to:
          count += 1
  return count


def enumerate_dates(start: str, end: str) -> list[date]:
  cursor = parse_date(start, "start")
  last = parse_date(end, "end")
  dates = []
  while cursor <= last and len(dates) < 120:
    dates.append(cursor)
    cursor += timedelta(days=1)
  return dates


def parse_date(value: object, label: str) -> date:
  try:
    return date.fromisoformat(str(value))
  except Exception as error:
    raise ValueError(f"{label} must be a valid YYYY-MM-DD date") from error


def clean_iata(value: object) -> str:
  candidate = str(value or "").strip().upper()
  return candidate if len(candidate) == 3 and candidate.isalpha() else ""


def clean_airline_code(value: object) -> str:
  candidate = str(value or "").strip().upper()
  return candidate if 2 <= len(candidate) <= 3 and candidate.isalnum() else ""


def normalize_max_stops(value: object) -> str:
  clean = str(value if value is not None else "0").strip().upper()
  if clean == "ANY":
    return "ANY"
  try:
    stops = int(float(clean))
  except Exception:
    return "0"
  return str(min(max(0, stops), 2))


def clamp_days(value: object, max_days: int) -> int:
  try:
    parsed = int(float(value))
  except Exception:
    parsed = 0
  return min(max(0, parsed), max_days)


def round_price(value: object) -> float:
  return round(float(value), 2)


def deal_sort_key(deal: dict) -> tuple:
  return (deal.get("price") or 0, deal.get("depart") or "", deal.get("length") or 0, deal.get("route") or "")


def curate_top_deals(candidates: list[dict], limit: int = TOP_DEAL_LIMIT) -> list[dict]:
  priced = [deal for deal in candidates if isinstance(deal.get("price"), (int, float))]
  if not priced:
    return [with_deal_reason(deal, "Direct search") for deal in candidates[:limit]]

  buckets = sorted(group_deals(priced, price_key).items(), key=lambda item: float(item[0]))
  labels = ["Lowest found", "Next lowest", "Third lowest", "Fourth lowest"]
  selected = []
  for index, (_price, deals) in enumerate(buckets[:limit]):
    lead = min(deals, key=deal_sort_key)
    selected.append(with_fare_options(
      lead,
      sorted(deals, key=deal_sort_key),
      labels[index] if index < len(labels) else "Also available",
      highlight="primary" if index == 0 else "",
    ))
  return selected


def group_deals(deals: list[dict], key_fn) -> dict[str, list[dict]]:
  groups: dict[str, list[dict]] = {}
  for deal in deals:
    key = key_fn(deal)
    if key:
      groups.setdefault(key, []).append(deal)
  return groups


def price_key(deal: dict) -> str:
  return str(float(deal.get("price") or 0))


def with_deal_reason(deal: dict, reason: str, *, highlight: str = "") -> dict:
  next_deal = dict(deal)
  next_deal["dealReason"] = reason
  if highlight:
    next_deal["dealHighlight"] = highlight
  return next_deal


def with_fare_options(deal: dict, options: list[dict], reason: str, *, highlight: str = "") -> dict:
  next_deal = with_deal_reason(deal, reason, highlight=highlight)
  next_deal["fareOptions"] = [compact_related_deal(option) for option in options]
  next_deal["fareOptionTotal"] = len(options)
  return next_deal


def compact_related_deal(deal: dict) -> dict:
  return {
    "route": deal.get("route"),
    "origin": deal.get("origin"),
    "destination": deal.get("destination"),
    "depart": deal.get("depart"),
    "returnDate": deal.get("returnDate"),
    "length": deal.get("length"),
    "price": deal.get("price"),
    "currency": deal.get("currency", "USD"),
    "stopCount": deal.get("stopCount"),
    "flightMinutes": deal.get("flightMinutes"),
    "maxStops": deal.get("maxStops"),
    "airlineName": deal.get("airlineName"),
    "airlineCode": deal.get("airlineCode"),
    "sourceUrl": deal.get("sourceUrl"),
  }


def deal_identity(deal: dict) -> tuple:
  return (
    deal.get("origin") or "",
    deal.get("destination") or "",
    deal.get("depart") or "",
    deal.get("returnDate") or "",
    deal.get("length") or 0,
  )


def price_per_day(deal: dict) -> float:
  return float(deal.get("price") or 0) / max(1, int(deal.get("length") or 0))


def format_route(pair: dict) -> str:
  return f"{pair['origin']} → {pair['destination']}"


def unique_values(values: list[str]) -> list[str]:
  seen = set()
  output = []
  for value in values:
    if not value or value in seen:
      continue
    seen.add(value)
    output.append(value)
  return output


def short_error(error: Exception) -> str:
  return " ".join(str(error).split())[:180]


def pluralize(count: int, singular: str, plural: str) -> str:
  return singular if count == 1 else plural


def google_flights_url(origin: str, destination: str, depart: str, return_date: str) -> str:
  query = quote(f"{origin} to {destination} {depart} {return_date}")
  return f"https://www.google.com/travel/flights/search?q={query}&hl=en-US&gl=US&curr=USD"


def cached_sweep_for_monitor(monitor: dict) -> dict | None:
  try:
    normalized = normalize_monitor(monitor)
  except Exception:
    return None
  cached = read_cache(sweep_cache, sweep_cache_key(normalized))
  if cached:
    cached["cacheStatus"] = "hit"
  return cached


def sweep_cache_key(normalized: dict) -> str:
  return json.dumps({
    "pairs": sorted(normalized["pairs"], key=lambda pair: (pair["origin"], pair["destination"])),
    "start_from": normalized["start_from"],
    "start_to": normalized["start_to"],
    "trip_min": normalized["trip_min"],
    "trip_max": normalized["trip_max"],
    "max_stops": normalized["max_stops"],
    "airline_mode": normalized["airline_mode"],
    "excluded_airlines": sorted(normalized["excluded_airlines"]),
  }, sort_keys=True, separators=(",", ":"))


def flight_detail_cache_key(deal: dict, monitor: dict) -> str:
  return json.dumps({
    "origin": deal.get("origin"),
    "destination": deal.get("destination"),
    "depart": deal.get("depart"),
    "returnDate": deal.get("returnDate"),
    "max_stops": monitor.get("max_stops"),
    "airline_mode": monitor.get("airline_mode"),
    "airlines": sorted(monitor.get("excluded_airlines") or []),
  }, sort_keys=True, separators=(",", ":"))


def search_query_cache_key(pair: dict, monitor: dict, duration: int, search_type: str) -> str:
  return json.dumps({
    "type": search_type,
    "origin": pair.get("origin"),
    "destination": pair.get("destination"),
    "start_from": monitor.get("start_from"),
    "start_to": monitor.get("start_to"),
    "duration": duration,
    "max_stops": monitor.get("max_stops"),
    "airline_mode": monitor.get("airline_mode"),
    "excluded_airlines": sorted(monitor.get("excluded_airlines") or []),
  }, sort_keys=True, separators=(",", ":"))


def read_cache(cache: dict[str, dict], key: str) -> dict | None:
  record = cache.get(key)
  if not record:
    return None
  if record["expires_at"] <= time.time():
    del cache[key]
    return None
  return json.loads(json.dumps(record["value"]))


def write_cache(cache: dict[str, dict], key: str, value: dict, ttl_seconds: int) -> None:
  cache[key] = {
    "expires_at": time.time() + ttl_seconds,
    "value": json.loads(json.dumps(value)),
  }


def check_rate_limit(client_id: str, ip_address: str) -> tuple[bool, int]:
  ip_ok, ip_retry = consume_rate_limit(f"ip:{ip_address}", MAX_SWEEPS_PER_IP_WINDOW)
  if not ip_ok:
    return False, ip_retry
  client_ok, client_retry = consume_rate_limit(f"client:{client_id}", MAX_SWEEPS_PER_CLIENT_WINDOW)
  return client_ok, client_retry


def consume_rate_limit(key: str, limit: int) -> tuple[bool, int]:
  now = time.time()
  cutoff = now - RATE_WINDOW_SECONDS
  timestamps = [stamp for stamp in rate_limit_hits.get(key, []) if stamp > cutoff]
  if len(timestamps) >= limit:
    oldest = min(timestamps)
    retry_after = max(1, int(RATE_WINDOW_SECONDS - (now - oldest)))
    rate_limit_hits[key] = timestamps
    return False, retry_after
  timestamps.append(now)
  rate_limit_hits[key] = timestamps
  prune_rate_limit_hits(cutoff)
  return True, 0


def prune_rate_limit_hits(cutoff: float) -> None:
  if len(rate_limit_hits) < 500:
    return
  for key, timestamps in list(rate_limit_hits.items()):
    kept = [stamp for stamp in timestamps if stamp > cutoff]
    if kept:
      rate_limit_hits[key] = kept
    else:
      del rate_limit_hits[key]


def request_origin(headers) -> str:
  protocol = headers.get("X-Forwarded-Proto") or "http"
  if protocol not in ("http", "https"):
    protocol = "http"
  host = safe_host(headers.get("Host") or "127.0.0.1:8001")
  return f"{protocol}://{host}"


def safe_host(value: str) -> str:
  host = str(value).strip().split(",", 1)[0]
  if not host or len(host) > 255:
    return "127.0.0.1:8001"
  allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-:[]")
  if any(character not in allowed for character in host):
    return "127.0.0.1:8001"
  return host


def shared_preview_context(encoded: str | None) -> dict:
  monitors = decode_shared_monitors(encoded)
  monitor_count = len(monitors)
  pairs = [pair for monitor in monitors for pair in monitor.get("pairs", [])]
  pair_count = len(pairs)
  route_labels = [format_route(pair) for pair in pairs[:8]]
  more_routes = max(0, pair_count - len(route_labels))

  if monitor_count:
    title_routes = ", ".join(route_labels[:2])
    if pair_count > 2:
      title_routes = f"{title_routes} + {pair_count - 2} more"
    title = f"Fareless: {title_routes}"
    date_summary = summarize_monitor_dates(monitors)
    exclusions = sorted({code for monitor in monitors for code in monitor.get("excludedAirlines", [])})
    stop_rules = sorted({format_stops(monitor.get("maxStops", 0)) for monitor in monitors})
    description_parts = [
      f"{monitor_count} {plural(monitor_count, 'trip')}",
      f"{pair_count} airport {plural(pair_count, 'pair')}",
      date_summary,
    ]
    if exclusions:
      description_parts.append(f"{len(exclusions)} airline {plural(len(exclusions), 'exclusion')}")
    if len(stop_rules) == 1:
      description_parts.append(stop_rules[0])
    description = " • ".join(part for part in description_parts if part)
  else:
    title = "Fareless"
    description = "Build flexible trips and find Google Flights fares across date windows."

  return {
    "monitors": monitors,
    "monitor_count": monitor_count,
    "pair_count": pair_count,
    "route_labels": route_labels,
    "more_routes": more_routes,
    "title": title,
    "description": description,
  }


def decode_shared_monitors(encoded: str | None) -> list[dict]:
  if not encoded:
    return []
  if len(str(encoded)) > MAX_SHARE_PARAM_CHARS:
    return []
  try:
    payload = json.loads(base64.urlsafe_b64decode(pad_base64(encoded)).decode("utf-8"))
  except Exception:
    return []
  return normalize_share_payload(payload)


def pad_base64(value: str) -> bytes:
  clean = "".join(character for character in str(value) if character.isalnum() or character in "-_")
  clean += "=" * (-len(clean) % 4)
  return clean.encode("ascii")


def normalize_share_payload(payload: object) -> list[dict]:
  if not isinstance(payload, dict):
    return []
  raw_monitors = payload.get("monitors") or payload.get("m") or []
  monitors = []
  for raw_monitor in raw_monitors:
    monitor = monitor_from_share_value(raw_monitor)
    if monitor.get("pairs"):
      monitors.append(monitor)
  return monitors[:20]


def monitor_from_share_value(value: object) -> dict:
  if isinstance(value, list):
    pair_values = value[0] if len(value) > 0 else []
    has_max_stops = len(value) > 5 and not isinstance(value[5], list)
    excluded_airlines = value[6] if has_max_stops and len(value) > 6 else value[5] if len(value) > 5 else []
    airline_mode = value[7] if has_max_stops and len(value) > 7 else "exclude"
    pairs = [
      {"origin": clean_iata(pair[0] if len(pair) > 0 else ""), "destination": clean_iata(pair[1] if len(pair) > 1 else "")}
      for pair in pair_values
      if isinstance(pair, list)
    ]
    monitor = {
      "pairs": [pair for pair in pairs if pair["origin"] and pair["destination"] and pair["origin"] != pair["destination"]],
      "startFrom": value[1] if len(value) > 1 else "",
      "startTo": value[2] if len(value) > 2 else "",
      "tripMin": value[3] if len(value) > 3 else 0,
      "tripMax": value[4] if len(value) > 4 else 0,
      "maxStops": normalize_max_stops(value[5] if has_max_stops else 0),
      "excludedAirlines": [clean_airline_code(code) for code in (excluded_airlines if isinstance(excluded_airlines, list) else [])],
      "airlineMode": "include" if airline_mode == "include" else "exclude",
    }
  elif isinstance(value, dict):
    monitor = {
      "pairs": [
        {"origin": clean_iata(pair.get("origin")), "destination": clean_iata(pair.get("destination"))}
        for pair in value.get("pairs", [])
        if isinstance(pair, dict)
      ],
      "startFrom": value.get("startFrom", ""),
      "startTo": value.get("startTo", ""),
      "tripMin": value.get("tripMin", 0),
      "tripMax": value.get("tripMax", 0),
      "maxStops": normalize_max_stops(value.get("maxStops", 0)),
      "excludedAirlines": [clean_airline_code(code) for code in value.get("excludedAirlines", [])],
      "airlineMode": "include" if value.get("airlineMode") == "include" else "exclude",
    }
  else:
    return {"pairs": []}

  monitor["pairs"] = unique_pair_dicts(monitor["pairs"])
  monitor["excludedAirlines"] = sorted({code for code in monitor["excludedAirlines"] if code})
  monitor["airlineMode"] = "include" if monitor.get("airlineMode") == "include" else "exclude"
  monitor["maxStops"] = normalize_max_stops(monitor.get("maxStops", 0))
  return monitor


def unique_pair_dicts(pairs: list[dict]) -> list[dict]:
  seen = set()
  output = []
  for pair in pairs:
    key = (pair.get("origin"), pair.get("destination"))
    if not key[0] or not key[1] or key in seen:
      continue
    seen.add(key)
    output.append(pair)
  return output


def summarize_monitor_dates(monitors: list[dict]) -> str:
  if not monitors:
    return ""
  starts = [parse_safe_date(monitor.get("startFrom")) for monitor in monitors]
  ends = [parse_safe_date(monitor.get("startTo")) for monitor in monitors]
  starts = [value for value in starts if value]
  ends = [value for value in ends if value]
  days = [(safe_int(monitor.get("tripMin")), safe_int(monitor.get("tripMax"))) for monitor in monitors]
  if not starts or not ends:
    return ""
  min_days = min(day[0] for day in days)
  max_days = max(day[1] for day in days)
  return f"{format_short_date(min(starts))}-{format_short_date(max(ends))} • {min_days}-{max_days} days"


def parse_safe_date(value: object) -> date | None:
  try:
    return date.fromisoformat(str(value))
  except Exception:
    return None


def safe_int(value: object) -> int:
  try:
    return max(0, int(float(value)))
  except Exception:
    return 0


def format_short_date(value: date) -> str:
  return value.strftime("%b %-d") if os.name != "nt" else value.strftime("%b %#d")


def format_stops(value: object) -> str:
  max_stops = normalize_max_stops(value)
  if max_stops == "ANY":
    return "any stops"
  if max_stops == "0":
    return "nonstop"
  if max_stops == "1":
    return "1 stop max"
  return "2 stops max"


def plural(count: int, singular: str) -> str:
  return singular if count == 1 else f"{singular}s"


def index_with_preview_meta(headers, query: dict[str, list[str]]) -> bytes:
  encoded = (query.get("m") or [""])[0]
  context = shared_preview_context(encoded)
  origin = request_origin(headers)
  current_url = f"{origin}/"
  if encoded:
    current_url = f"{current_url}?{urlencode({'m': encoded})}"
  meta = preview_meta_tags(context["title"], context["description"], current_url)
  html_body = (ROOT / "index.html").read_text("utf-8")
  html_body = remove_default_preview_meta(html_body)
  return html_body.replace("<!-- link-preview-meta -->", meta).encode("utf-8")


def remove_default_preview_meta(html_body: str) -> str:
  start_marker = "    <!-- default-link-preview-meta-start -->"
  end_marker = "    <!-- default-link-preview-meta-end -->"
  start = html_body.find(start_marker)
  end = html_body.find(end_marker)
  if start < 0 or end < 0:
    return html_body
  end += len(end_marker)
  return f"{html_body[:start]}{html_body[end:]}"


def preview_meta_tags(title: str, description: str, url: str) -> str:
  values = {
    "title": html.escape(title, quote=True),
    "description": html.escape(description, quote=True),
    "url": html.escape(url, quote=True),
  }
  return f"""
    <meta property="og:title" content="{values['title']}">
    <meta property="og:description" content="{values['description']}">
    <meta property="og:url" content="{values['url']}">
    <meta name="twitter:card" content="summary">
    <meta name="twitter:title" content="{values['title']}">
    <meta name="twitter:description" content="{values['description']}">
    """


class FlightTrackerHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(ROOT), **kwargs)

  def send_head(self):
    parsed = urlparse(self.path)
    query = parse_qs(parsed.query)
    if parsed.path in ("/", "/index.html"):
      return self.dynamic_bytes(
        index_with_preview_meta(self.headers, query),
        "text/html; charset=utf-8",
      )
    if not self.is_public_static_path():
      self.send_error(HTTPStatus.NOT_FOUND)
      return None
    return super().send_head()

  def do_POST(self) -> None:
    if self.path != "/api/sweep":
      self.send_error(HTTPStatus.NOT_FOUND)
      return
    try:
      content_type = self.headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
      if content_type != "application/json":
        self.send_error(HTTPStatus.UNSUPPORTED_MEDIA_TYPE)
        return
      content_length = int(self.headers.get("Content-Length", "0"))
      if content_length > MAX_BODY_BYTES:
        self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        return
      payload = json.loads(self.rfile.read(content_length) or b"{}")
      monitor = payload.get("monitor") or {}
      cached = cached_sweep_for_monitor(monitor)
      if cached:
        self.send_json(cached)
        return
      allowed, retry_after = check_rate_limit(self.client_id(), self.client_ip())
      if not allowed:
        self.send_json(
          {"error": "Too many fare searches. Please wait a bit before trying again."},
          status=HTTPStatus.TOO_MANY_REQUESTS,
          headers={"Retry-After": str(retry_after)},
        )
        return
      result = sweep_monitor(monitor)
      self.send_json(result)
    except Exception as error:
      self.send_error(HTTPStatus.BAD_GATEWAY, short_error(error))

  def client_id(self) -> str:
    raw_client = self.headers.get("X-Flight-Tracker-Client", "")
    clean_client = "".join(char for char in raw_client if char.isalnum() or char in "-_")[:80]
    return clean_client or "anonymous"

  def client_ip(self) -> str:
    forwarded_for = self.headers.get("X-Forwarded-For", "")
    if forwarded_for:
      candidate = forwarded_for.split(",", 1)[0].strip()
      if candidate and len(candidate) <= 64:
        return candidate
    return self.client_address[0]

  def is_public_static_path(self) -> bool:
    path = unquote(urlparse(self.path).path)
    if "\x00" in path or "\\" in path:
      return False
    if posixpath.normpath(path) != path:
      return False
    if path in PUBLIC_STATIC_PATHS:
      return True
    if path.startswith(PUBLIC_STATIC_PREFIXES) and not path.endswith("/"):
      return Path(path).suffix.lower() in PUBLIC_ASSET_EXTENSIONS
    return False

  def end_headers(self) -> None:
    self.send_security_headers()
    super().end_headers()

  def send_security_headers(self) -> None:
    self.send_header("X-Content-Type-Options", "nosniff")
    self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
    self.send_header("X-Frame-Options", "DENY")
    self.send_header("Cross-Origin-Opener-Policy", "same-origin")
    self.send_header("Permissions-Policy", "geolocation=(), camera=(), microphone=(), payment=()")
    self.send_header(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
      "script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'",
    )
    if self.headers.get("X-Forwarded-Proto") == "https":
      self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

  def dynamic_bytes(self, body: bytes, content_type: str):
    self.send_response(HTTPStatus.OK)
    self.send_header("Content-Type", content_type)
    self.send_header("Cache-Control", "public, max-age=300")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    return io.BytesIO(body)

  def send_json(self, value: dict, status: HTTPStatus = HTTPStatus.OK, headers: dict[str, str] | None = None) -> None:
    body = json.dumps(value).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json")
    self.send_header("Content-Length", str(len(body)))
    for name, header_value in (headers or {}).items():
      self.send_header(name, header_value)
    self.end_headers()
    self.wfile.write(body)


def main() -> None:
  parser = argparse.ArgumentParser(description="Run Fareless with the live fare sweep endpoint.")
  parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
  parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8001")))
  args = parser.parse_args()

  server = ThreadingHTTPServer((args.host, args.port), FlightTrackerHandler)
  print(f"Fareless running at http://{args.host}:{args.port}/")
  server.serve_forever()


if __name__ == "__main__":
  main()
