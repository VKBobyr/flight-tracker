#!/usr/bin/env python3
"""Serve the Flight Tracker static app during local development."""

from __future__ import annotations

import argparse
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class FlightTrackerHandler(SimpleHTTPRequestHandler):
  def __init__(self, *args, **kwargs):
    super().__init__(*args, directory=str(ROOT), **kwargs)


def main() -> None:
  parser = argparse.ArgumentParser(description="Run the Flight Tracker static server.")
  parser.add_argument("--host", default="127.0.0.1")
  parser.add_argument("--port", type=int, default=8001)
  args = parser.parse_args()

  server = ThreadingHTTPServer((args.host, args.port), FlightTrackerHandler)
  print(f"Flight Tracker running at http://{args.host}:{args.port}/")
  server.serve_forever()


if __name__ == "__main__":
  main()
