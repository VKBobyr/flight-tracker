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
  }


class DealCurationTests(unittest.TestCase):
  def test_curates_six_distinct_deals_with_reason_labels(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-10", 2),
      deal("SFO-TPA", 130, "2026-07-11", 10),
      deal("SJC-MCO", 112, "2026-07-14", 7),
      deal("SFO-LAX", 125, "2026-07-09", 1),
      deal("SFO-BOS", 110, "2026-07-01", 4),
      deal("SJC-SEA", 105, "2026-07-12", 3),
      deal("SJC-LAS", 106, "2026-07-13", 3),
    ]

    curated = server.curate_top_deals(candidates, 6)

    self.assertEqual(len(curated), 6)
    self.assertEqual(
      [entry["dealReason"] for entry in curated],
      ["Cheapest", "Best value", "Longest low fare", "Shortest", "Earliest good fare", "Next cheapest"],
    )
    self.assertEqual(
      [entry["route"] for entry in curated],
      ["SFO → SEA", "SFO → TPA", "SJC → MCO", "SFO → LAX", "SFO → BOS", "SJC → SEA"],
    )

  def test_skips_duplicate_category_winners_and_fills_with_next_cheapest(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-01", 1),
      deal("SJC-SEA", 102, "2026-07-02", 2),
      deal("SFO-LAX", 103, "2026-07-03", 3),
    ]

    curated = server.curate_top_deals(candidates, 6)

    self.assertEqual(len(curated), 3)
    self.assertEqual(len({server.deal_identity(entry) for entry in curated}), 3)
    self.assertEqual(curated[0]["dealReason"], "Cheapest")

  def test_unpriced_deals_become_direct_searches(self):
    candidates = [
      {"route": "SFO → SEA", "origin": "SFO", "destination": "SEA", "depart": "2026-07-01", "returnDate": "2026-07-03", "length": 2},
      {"route": "SJC → SEA", "origin": "SJC", "destination": "SEA", "depart": "2026-07-02", "returnDate": "2026-07-04", "length": 2},
    ]

    curated = server.curate_top_deals(candidates, 6)

    self.assertEqual([entry["dealReason"] for entry in curated], ["Direct search", "Direct search"])


if __name__ == "__main__":
  unittest.main()
