import unittest

import server


class SecurityHardeningTests(unittest.TestCase):
  def setUp(self):
    server.rate_limit_hits.clear()

  def test_static_path_rejects_asset_dot_segments(self):
    handler = object.__new__(server.FlightTrackerHandler)
    handler.path = "/assets/../server.py"

    self.assertFalse(handler.is_public_static_path())

  def test_static_path_allows_known_asset_extension(self):
    handler = object.__new__(server.FlightTrackerHandler)
    handler.path = "/assets/flight-tracker-logo.png"

    self.assertTrue(handler.is_public_static_path())

  def test_static_path_rejects_asset_directory_listing(self):
    handler = object.__new__(server.FlightTrackerHandler)
    handler.path = "/assets/"

    self.assertFalse(handler.is_public_static_path())

  def test_share_payload_over_length_is_ignored(self):
    self.assertEqual(server.decode_shared_monitors("a" * (server.MAX_SHARE_PARAM_CHARS + 1)), [])

  def test_safe_host_rejects_header_injection_characters(self):
    self.assertEqual(server.safe_host("example.com\r\nX-Evil: 1"), "127.0.0.1:8001")
    self.assertEqual(server.safe_host("fareless.example:443"), "fareless.example:443")

  def test_ip_rate_limit_denial_does_not_consume_client_bucket(self):
    server.MAX_SWEEPS_PER_IP_WINDOW = 1
    server.MAX_SWEEPS_PER_CLIENT_WINDOW = 100
    try:
      self.assertEqual(server.check_rate_limit("client-a", "203.0.113.7"), (True, 0))
      allowed, retry_after = server.check_rate_limit("client-b", "203.0.113.7")

      self.assertFalse(allowed)
      self.assertGreaterEqual(retry_after, 1)
      self.assertNotIn("client:client-b", server.rate_limit_hits)
    finally:
      server.MAX_SWEEPS_PER_IP_WINDOW = int(server.os.environ.get("MAX_SWEEPS_PER_IP_WINDOW", "30"))
      server.MAX_SWEEPS_PER_CLIENT_WINDOW = int(server.os.environ.get("MAX_SWEEPS_PER_CLIENT_WINDOW", "12"))


if __name__ == "__main__":
  unittest.main()
