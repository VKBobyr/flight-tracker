#!/usr/bin/env python3
"""Serve Flight Tracker locally and provide live priced sweeps through Fli."""

from __future__ import annotations

import argparse
import json
import os
import time
from datetime import date, datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlparse

try:
  from fli.core import build_date_search_segments, build_flight_segments
  from fli.core.parsers import parse_airlines, parse_cabin_class, parse_max_stops, resolve_airport
  from fli.models import DateSearchFilters, FlightSearchFilters, PassengerInfo, SortBy
  from fli.search import SearchDates, SearchFlights
except ImportError:
  build_date_search_segments = None
  build_flight_segments = None
  parse_airlines = None
  parse_cabin_class = None
  parse_max_stops = None
  resolve_airport = None
  DateSearchFilters = None
  FlightSearchFilters = None
  PassengerInfo = None
  SearchDates = None
  SearchFlights = None
  SortBy = None


ROOT = Path(__file__).resolve().parent
MAX_BODY_BYTES = 2 * 1024 * 1024
TOP_DEAL_LIMIT = 5
MAX_FLI_QUERIES_PER_MONITOR = 80
RATE_WINDOW_SECONDS = int(os.environ.get("RATE_WINDOW_SECONDS", "3600"))
MAX_SWEEPS_PER_CLIENT_WINDOW = int(os.environ.get("MAX_SWEEPS_PER_CLIENT_WINDOW", "12"))
MAX_SWEEPS_PER_IP_WINDOW = int(os.environ.get("MAX_SWEEPS_PER_IP_WINDOW", "30"))
rate_limit_hits: dict[str, list[float]] = {}
PUBLIC_STATIC_PATHS = {
  "/",
  "/index.html",
  "/app.js",
  "/styles.css",
  "/travel-windows.js",
}
PUBLIC_STATIC_PREFIXES = ("/assets/",)


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
  candidates: list[dict] = []
  provider_errors: list[str] = []
  query_count = 0

  for pair in normalized["pairs"]:
    for duration in range(normalized["trip_min"], normalized["trip_max"] + 1):
      if query_count >= MAX_FLI_QUERIES_PER_MONITOR:
        provider_errors.append(f"Stopped after {MAX_FLI_QUERIES_PER_MONITOR} live fare queries to avoid overloading the provider.")
        break
      try:
        if duration == 0:
          trips, used_queries = search_same_day_flights(pair, normalized)
        else:
          trips, used_queries = search_flexible_dates(pair, normalized, duration)
        candidates.extend(trips)
        query_count += used_queries
      except Exception as error:
        provider_errors.append(f"{format_route(pair)} / {duration} days: {short_error(error)}")

  if not candidates and provider_errors:
    raise RuntimeError("; ".join(provider_errors[:3]))

  candidates.sort(key=deal_sort_key)
  top_deals = enrich_deal_airlines(candidates[:TOP_DEAL_LIMIT], normalized)
  prices = [deal["price"] for deal in candidates if isinstance(deal.get("price"), (int, float))]
  average_price = round(sum(prices) / len(prices), 2) if prices else 0

  return {
    "provider": "fli",
    "ranAt": datetime.now(timezone.utc).isoformat(),
    "averagePrice": average_price,
    "topDeals": top_deals,
    "candidateCount": len(candidates),
    "combinationCount": normalized["combination_count"],
    "providerErrors": provider_errors[:6],
  }


def normalize_monitor(monitor: dict) -> dict:
  if not isinstance(monitor, dict):
    raise ValueError("Monitor payload must be an object")

  pairs = []
  seen_pairs = set()
  for pair in monitor.get("pairs") or []:
    origin = clean_iata(pair.get("origin"))
    destination = clean_iata(pair.get("destination"))
    key = (origin, destination)
    if origin and destination and origin != destination and key not in seen_pairs:
      pairs.append({"origin": origin, "destination": destination})
      seen_pairs.add(key)
  if not pairs:
    raise ValueError("Add at least one airport pair before sweeping")

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
  })

  return {
    "pairs": pairs,
    "start_from": start_from.isoformat(),
    "start_to": start_to.isoformat(),
    "trip_min": trip_min,
    "trip_max": trip_max,
    "excluded_airlines": excluded_airlines,
    "combination_count": count_combinations(pairs, start_from, start_to, trip_min, trip_max),
  }


def search_flexible_dates(pair: dict, monitor: dict, duration: int) -> tuple[list[dict], int]:
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
    stops=parse_max_stops("ANY"),
    seat_type=parse_cabin_class("ECONOMY"),
    airlines_exclude=parse_airlines(monitor["excluded_airlines"]),
    from_date=monitor["start_from"],
    to_date=monitor["start_to"],
    duration=duration,
  )
  results = SearchDates().search(filters, currency="USD", language="en-US", country="US") or []
  return [
    deal_from_date_price(pair, result)
    for result in results
    if date_price_matches(result, monitor, duration)
  ], 1


def search_same_day_flights(pair: dict, monitor: dict) -> tuple[list[dict], int]:
  deals = []
  query_count = 0
  excluded = set(monitor["excluded_airlines"])
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
      stops=parse_max_stops("ANY"),
      seat_type=parse_cabin_class("ECONOMY"),
      airlines_exclude=parse_airlines(monitor["excluded_airlines"]),
      sort_by=SortBy.CHEAPEST,
    )
    results = SearchFlights().search(filters, top_n=3, currency="USD", language="en-US", country="US") or []
    query_count += 1
    deals.extend(
      deal
      for deal in (flight_result_to_deal(pair, result, depart.isoformat(), depart.isoformat(), excluded) for result in results)
      if deal
    )
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
    "airlineName": ", ".join(unique_values(airline_names)) or "Check Google Flights for airline",
    "sourceName": "Google Flights",
    "sourceUrl": google_flights_url(pair["origin"], pair["destination"], depart, return_date),
    "provider": "fli",
  }


def enrich_deal_airlines(deals: list[dict], monitor: dict) -> list[dict]:
  enriched = []
  excluded = set(monitor["excluded_airlines"])
  for deal in deals:
    if deal.get("airlineName"):
      enriched.append(deal)
      continue
    try:
      enriched.append(enrich_single_deal_airline(deal, excluded))
    except Exception:
      deal["airlineName"] = "Check Google Flights for airline"
      enriched.append(deal)
  return enriched


def enrich_single_deal_airline(deal: dict, excluded: set[str]) -> dict:
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
    stops=parse_max_stops("ANY"),
    seat_type=parse_cabin_class("ECONOMY"),
    airlines_exclude=parse_airlines(list(excluded)),
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
    deal["airlineName"] = best.get("airlineName") or "Check Google Flights for airline"
  else:
    deal["airlineName"] = "Check Google Flights for airline"
  return deal


def collect_airlines(flight: object, airline_codes: list[str], airline_names: list[str]) -> None:
  for leg in getattr(flight, "legs", []) or []:
    airline = getattr(leg, "airline", None)
    raw_code = getattr(airline, "name", "") or ""
    code = raw_code.removeprefix("_").upper()
    if code:
      airline_codes.append(code)
    name = getattr(airline, "label", None) or getattr(airline, "display_name", None) or code
    if name:
      airline_names.append(str(name))


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


def google_flights_url(origin: str, destination: str, depart: str, return_date: str) -> str:
  query = quote(f"{origin} to {destination} {depart} {return_date}")
  return f"https://www.google.com/travel/flights/search?q={query}&hl=en-US&gl=US&curr=USD"


def check_rate_limit(client_id: str, ip_address: str) -> tuple[bool, int]:
  client_ok, client_retry = consume_rate_limit(f"client:{client_id}", MAX_SWEEPS_PER_CLIENT_WINDOW)
  ip_ok, ip_retry = consume_rate_limit(f"ip:{ip_address}", MAX_SWEEPS_PER_IP_WINDOW)
  return client_ok and ip_ok, max(client_retry, ip_retry)


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


class FlightTrackerHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(ROOT), **kwargs)

  def send_head(self):
    if not self.is_public_static_path():
      self.send_error(HTTPStatus.NOT_FOUND)
      return None
    return super().send_head()

  def do_POST(self) -> None:
    if self.path != "/api/sweep":
      self.send_error(HTTPStatus.NOT_FOUND)
      return
    try:
      allowed, retry_after = check_rate_limit(self.client_id(), self.client_address[0])
      if not allowed:
        self.send_json(
          {"error": "Too many sweeps. Please wait a bit before running another search."},
          status=HTTPStatus.TOO_MANY_REQUESTS,
          headers={"Retry-After": str(retry_after)},
        )
        return
      content_length = int(self.headers.get("Content-Length", "0"))
      if content_length > MAX_BODY_BYTES:
        self.send_error(HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
        return
      payload = json.loads(self.rfile.read(content_length) or b"{}")
      result = sweep_monitor(payload.get("monitor") or {})
      self.send_json(result)
    except Exception as error:
      self.send_error(HTTPStatus.BAD_GATEWAY, short_error(error))

  def client_id(self) -> str:
    raw_client = self.headers.get("X-Flight-Tracker-Client", "")
    clean_client = "".join(char for char in raw_client if char.isalnum() or char in "-_")[:80]
    return clean_client or "anonymous"

  def is_public_static_path(self) -> bool:
    path = unquote(urlparse(self.path).path)
    return path in PUBLIC_STATIC_PATHS or any(path.startswith(prefix) for prefix in PUBLIC_STATIC_PREFIXES)

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
  parser = argparse.ArgumentParser(description="Run Flight Tracker with the live fare sweep endpoint.")
  parser.add_argument("--host", default=os.environ.get("HOST", "127.0.0.1"))
  parser.add_argument("--port", type=int, default=int(os.environ.get("PORT", "8001")))
  args = parser.parse_args()

  server = ThreadingHTTPServer((args.host, args.port), FlightTrackerHandler)
  print(f"Flight Tracker running at http://{args.host}:{args.port}/")
  server.serve_forever()


if __name__ == "__main__":
  main()
