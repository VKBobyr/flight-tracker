import unittest

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

  def test_fare_bucket_caps_visible_options_but_keeps_total(self):
    candidates = [
      deal("SFO-SEA", 100, f"2026-07-{day:02d}", day)
      for day in range(1, 9)
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual(curated[0]["fareOptionTotal"], 8)
    self.assertEqual(len(curated[0]["fareOptions"]), server.MAX_FARE_OPTIONS_PER_BUCKET)

  def test_fare_bucket_airline_summary_ignores_placeholder(self):
    bucket = {}

    server.apply_fare_bucket_airline_summary(bucket, [
      {**deal("SFO-SEA", 100, "2026-07-01", 4), "airlineName": server.AIRLINE_PLACEHOLDER, "airlineCode": ""},
      {**deal("SFO-SEA", 100, "2026-07-02", 4), "airlineName": "", "airlineCode": ""},
    ])

    self.assertEqual(bucket["airlineName"], "")

  def test_unpriced_deals_become_direct_searches(self):
    candidates = [
      {"route": "SFO → SEA", "origin": "SFO", "destination": "SEA", "depart": "2026-07-01", "returnDate": "2026-07-03", "length": 2},
      {"route": "SJC → SEA", "origin": "SJC", "destination": "SEA", "depart": "2026-07-02", "returnDate": "2026-07-04", "length": 2},
    ]

    curated = server.curate_top_deals(candidates, 4)

    self.assertEqual([entry["dealReason"] for entry in curated], ["Direct search", "Direct search"])


if __name__ == "__main__":
  unittest.main()
