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
  def test_curates_smart_categories_with_reason_labels(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-10", 2),
      deal("SFO-TPA", 130, "2026-07-11", 10),
      deal("SJC-MCO", 112, "2026-07-14", 7),
      deal("SFO-LAX", 125, "2026-07-09", 1),
      deal("SFO-BOS", 110, "2026-07-01", 4),
      deal("SJC-SEA", 105, "2026-07-12", 3),
      deal("SJC-LAS", 106, "2026-07-13", 3),
    ]

    curated = server.curate_top_deals(candidates, 12)

    self.assertEqual(len(curated), 7)
    self.assertEqual(
      [entry["dealReason"] for entry in curated[:5]],
      ["Best overall", "Best value", "Cheapest SJC → SEA", "Cheapest SJC → LAS", "Cheapest SFO → BOS"],
    )
    self.assertEqual(curated[0]["dealHighlight"], "primary")
    self.assertEqual(curated[1]["dealHighlight"], "primary")
    self.assertIn("Best 1-day trip", [entry["dealReason"] for entry in curated])

  def test_skips_duplicate_category_winners_and_fills_with_next_cheapest(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-01", 1),
      deal("SJC-SEA", 102, "2026-07-02", 2),
      deal("SFO-LAX", 103, "2026-07-03", 3),
    ]

    curated = server.curate_top_deals(candidates, 6)

    self.assertEqual(len(curated), 3)
    self.assertEqual(len({server.deal_identity(entry) for entry in curated}), 3)
    self.assertEqual(curated[0]["dealReason"], "Best overall")

  def test_groups_same_price_matches_under_lead_deal(self):
    candidates = [
      deal("SFO-SEA", 100, "2026-07-01", 2),
      deal("SJC-SEA", 100, "2026-07-02", 3),
      deal("SFO-LAX", 120, "2026-07-03", 4),
    ]

    curated = server.curate_top_deals(candidates, 12)

    self.assertEqual(curated[0]["samePriceTotal"], 1)
    self.assertEqual(curated[0]["samePriceMatches"][0]["route"], "SJC → SEA")

  def test_unpriced_deals_become_direct_searches(self):
    candidates = [
      {"route": "SFO → SEA", "origin": "SFO", "destination": "SEA", "depart": "2026-07-01", "returnDate": "2026-07-03", "length": 2},
      {"route": "SJC → SEA", "origin": "SJC", "destination": "SEA", "depart": "2026-07-02", "returnDate": "2026-07-04", "length": 2},
    ]

    curated = server.curate_top_deals(candidates, 6)

    self.assertEqual([entry["dealReason"] for entry in curated], ["Direct search", "Direct search"])


if __name__ == "__main__":
  unittest.main()
