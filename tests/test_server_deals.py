import unittest
from types import SimpleNamespace

import server


def deal(route, price, depart, length):
  origin, destination = route.split("-")
  return {
    "route": f"{origin} → {destination}",
    "origin": origin,
    "destination": destination,
    "depart": depart,
    "returnDate": f"{depart}+{length}",
    "length": length,
    "price": price,
    "currency": "USD",
  }


class DealCurationTests(unittest.TestCase):
  def test_curates_top_price_buckets_with_trip_options(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-10", 2),
      deal("SFO-TPA", 130, "2026-07-11", 10),
      deal("SJC-MCO", 112, "2026-07-14", 7),
      deal("SFO-LAX", 125, "2026-07-09", 1),
      deal("SFO-BOS", 110, "2026-07-01", 4),
      deal("SJC-SEA", 105, "2026-07-12", 3),
      deal("SJC-LAS", 106, "2026-07-13", 3),
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual(len(curated), 4)
    self.assertEqual(
      [entry["dealReason"] for entry in curated],
      ["Lowest found", "Next lowest", "Third lowest", "Fourth lowest"],
    )
    self.assertEqual(curated[0]["dealHighlight"], "primary")
    self.assertEqual([entry["price"] for entry in curated], [100, 105, 106, 110])
    self.assertEqual(curated[0]["fareOptionTotal"], 1)
    self.assertEqual(curated[0]["fareOptions"][0]["route"], "SFO → SEA")

  def test_groups_same_price_options_under_one_bucket(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-01", 2),
      deal("SJC-SEA", 100, "2026-07-02", 3),
      deal("SFO-LAX", 103, "2026-07-03", 3),
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual(len(curated), 2)
    self.assertEqual(curated[0]["price"], 100)
    self.assertEqual(curated[0]["fareOptionTotal"], 2)
    self.assertEqual([option["route"] for option in curated[0]["fareOptions"]], ["SFO → SEA", "SJC → SEA"])
    self.assertEqual(curated[0]["fareOptions"][0]["price"], 100)

  def test_fare_bucket_keeps_all_options_for_selected_price(self):
    candidates = [
      deal("SFO-SEA", 100, f"2026-07-{day:02d}", day)
      for day in range(1, 9)
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual(curated[0]["fareOptionTotal"], 8)
    self.assertEqual(len(curated[0]["fareOptions"]), 8)

  def test_fare_bucket_airline_summary_ignores_placeholder(self):
    bucket = {}

    server.apply_fare_bucket_airline_summary(bucket, [
      {**deal("SFO-SEA", 100, "2026-07-01", 4), "airlineName": server.AIRLINE_PLACEHOLDER, "airlineCode": ""},
      {**deal("SFO-SEA", 100, "2026-07-02", 4), "airlineName": "", "airlineCode": ""},
    ])

    self.assertEqual(bucket["airlineName"], "")

  def test_propagates_known_airline_to_matching_fare_option(self):
    options = [
      {**deal("SFO-SEA", 100, "2026-07-01", 4), "airlineName": "Alaska Airlines", "airlineCode": "AS", "stopCount": 0},
      {**deal("SFO-SEA", 100, "2026-07-01", 4), "airlineName": server.AIRLINE_PLACEHOLDER, "airlineCode": "", "stopCount": None},
      {**deal("SFO-SEA", 100, "2026-07-02", 4), "airlineName": server.AIRLINE_PLACEHOLDER, "airlineCode": ""},
    ]

    server.propagate_known_airlines(options)

    self.assertEqual(options[1]["airlineName"], "Alaska Airlines")
    self.assertEqual(options[1]["airlineCode"], "AS")
    self.assertEqual(options[1]["stopCount"], 0)
    self.assertEqual(options[2]["airlineName"], server.AIRLINE_PLACEHOLDER)

  def test_unpriced_deals_become_direct_searches(self):
    candidates = [
      {"route": "SFO → SEA", "origin": "SFO", "destination": "SEA", "depart": "2026-07-01", "returnDate": "2026-07-03", "length": 2},
      {"route": "SJC → SEA", "origin": "SJC", "destination": "SEA", "depart": "2026-07-02", "returnDate": "2026-07-04", "length": 2},
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual([entry["dealReason"] for entry in curated], ["Direct search", "Direct search"])


class SearchPlanningTests(unittest.TestCase):
  def setUp(self):
    self.previous_limit = server.MAX_FLI_QUERIES_PER_MONITOR

  def tearDown(self):
    server.MAX_FLI_QUERIES_PER_MONITOR = self.previous_limit

  def test_plans_one_search_per_pair_and_trip_length(self):
    monitor = {
      "pairs": [{"origin": "SFO", "destination": "SEA"}, {"origin": "SJC", "destination": "SEA"}],
      "start_from": "2026-07-01",
      "start_to": "2026-07-10",
      "trip_min": 4,
      "trip_max": 6,
    }

    jobs, skipped = server.build_search_jobs(monitor)

    self.assertEqual(skipped, 0)
    self.assertEqual(len(jobs), 6)
    self.assertEqual(jobs[0][1], 4)
    self.assertEqual(jobs[-1][1], 6)

  def test_same_day_jobs_are_budgeted_by_start_date_count(self):
    server.MAX_FLI_QUERIES_PER_MONITOR = 5
    monitor = {
      "pairs": [{"origin": "SFO", "destination": "SEA"}, {"origin": "SJC", "destination": "SEA"}],
      "start_from": "2026-07-01",
      "start_to": "2026-07-03",
      "trip_min": 0,
      "trip_max": 1,
    }

    jobs, skipped = server.build_search_jobs(monitor)

    self.assertEqual([(job[0]["origin"], job[1]) for job in jobs], [("SFO", 0), ("SFO", 1), ("SJC", 1)])
    self.assertEqual(skipped, 1)


class AirlineFilterModeTests(unittest.TestCase):
  def test_normalizes_include_airline_mode(self):
    monitor = server.normalize_monitor({
      "pairs": [{"origin": "SFO", "destination": "SEA"}],
      "startFrom": "2026-07-01",
      "startTo": "2026-07-05",
      "tripMin": 2,
      "tripMax": 3,
      "airlineMode": "include",
      "excludedAirlines": ["ua"],
    })

    self.assertEqual(monitor["airline_mode"], "include")
    self.assertEqual(monitor["excluded_airlines"], ["UA"])

  def test_airline_mode_is_part_of_sweep_cache_key(self):
    base = {
      "pairs": [{"origin": "SFO", "destination": "SEA"}],
      "startFrom": "2026-07-01",
      "startTo": "2026-07-05",
      "tripMin": 2,
      "tripMax": 3,
      "excludedAirlines": ["UA"],
    }

    exclude_key = server.sweep_cache_key(server.normalize_monitor({**base, "airlineMode": "exclude"}))
    include_key = server.sweep_cache_key(server.normalize_monitor({**base, "airlineMode": "include"}))

    self.assertNotEqual(exclude_key, include_key)

  def test_airline_filter_kwargs_match_selected_mode(self):
    exclude_monitor = server.normalize_monitor({
      "pairs": [{"origin": "SFO", "destination": "SEA"}],
      "startFrom": "2026-07-01",
      "startTo": "2026-07-05",
      "tripMin": 2,
      "tripMax": 3,
      "airlineMode": "exclude",
      "excludedAirlines": ["ua", "as"],
    })
    include_monitor = server.normalize_monitor({
      **{
        "pairs": [{"origin": "SFO", "destination": "SEA"}],
        "startFrom": "2026-07-01",
        "startTo": "2026-07-05",
        "tripMin": 2,
        "tripMax": 3,
        "excludedAirlines": ["ua", "as"],
      },
      "airlineMode": "include",
    })

    exclude_kwargs = server.airline_filter_kwargs(exclude_monitor)
    include_kwargs = server.airline_filter_kwargs(include_monitor)

    self.assertEqual([airline.name for airline in exclude_kwargs["airlines_exclude"]], ["AS", "UA"])
    self.assertEqual([airline.name for airline in include_kwargs["airlines"]], ["AS", "UA"])


class FlightDurationTests(unittest.TestCase):
  def test_sums_outbound_and_return_flight_durations(self):
    flights = (
      SimpleNamespace(duration=335, legs=[]),
      SimpleNamespace(duration=290, legs=[]),
    )

    self.assertEqual(server.flight_duration_minutes(flights), 625)

  def test_falls_back_to_leg_durations(self):
    flights = (
      SimpleNamespace(duration=None, legs=[SimpleNamespace(duration=80), SimpleNamespace(duration=120)]),
      SimpleNamespace(duration=None, legs=[SimpleNamespace(duration=95)]),
    )

    self.assertEqual(server.flight_duration_minutes(flights), 295)

  def test_flight_result_to_deal_includes_total_flight_minutes(self):
    result = (
      SimpleNamespace(price=220, duration=150, stops=0, legs=[], primary_airline=None, primary_airline_name="United"),
      SimpleNamespace(price=220, duration=165, stops=0, legs=[], primary_airline=None, primary_airline_name="United"),
    )

    output = server.flight_result_to_deal(
      {"origin": "SFO", "destination": "SEA"},
      result,
      "2026-07-01",
      "2026-07-05",
      set(),
    )

    self.assertEqual(output["flightMinutes"], 315)


if __name__ == "__main__":
  unittest.main()
