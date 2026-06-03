import unittest
from types import SimpleNamespace

import server


class AirlineExtractionTests(unittest.TestCase):
  def test_primary_airline_uses_fli_enum_code_and_name(self):
    codes = []
    names = []

    server.collect_primary_airline(
      SimpleNamespace(primary_airline=SimpleNamespace(name="AA", value="American Airlines")),
      codes,
      names,
    )

    self.assertEqual(codes, ["AA"])
    self.assertEqual(names, ["American Airlines"])

  def test_leg_airlines_include_marketing_and_operating_carriers(self):
    codes = []
    names = []
    flight = SimpleNamespace(
      legs=[
        SimpleNamespace(
          airline=SimpleNamespace(name="AS", value="Alaska Airlines"),
          operating_airline=SimpleNamespace(name="QX", value="Horizon Air"),
        )
      ],
    )

    server.collect_airlines(flight, codes, names)

    self.assertEqual(codes, ["AS", "QX"])
    self.assertEqual(names, ["Alaska Airlines", "Horizon Air"])

  def test_placeholder_airline_is_not_treated_as_real_airline(self):
    self.assertFalse(server.has_real_airline({"airlineName": server.AIRLINE_PLACEHOLDER}))
    self.assertTrue(server.has_real_airline({"airlineName": "Delta"}))

  def test_best_available_airline_label_expands_airline_code(self):
    self.assertEqual(
      server.best_available_airline_label({"airlineCode": "AA", "airlineName": server.AIRLINE_PLACEHOLDER}),
      "American Airlines",
    )

  def test_stop_count_prefers_fli_stops_field(self):
    flights = (
      SimpleNamespace(stops=0, legs=[object(), object(), object()]),
      SimpleNamespace(stops=2, legs=[object()]),
    )

    self.assertEqual(server.stop_count_from_flights(flights), 2)


if __name__ == "__main__":
  unittest.main()
