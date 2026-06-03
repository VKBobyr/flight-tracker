# Flight Tracker

A flight fare dashboard with locally saved monitors, shareable monitor setup links, and live Google Flights pricing through a local Fli-powered sweep endpoint.

## Features

- Add multiple route monitors at the same time.
- Add multiple airport pairs to the same monitor.
- Fuzzy airport search by IATA code, airport name, city, or country.
- Fuzzy airline search for excluded airlines.
- Flexible earliest start and latest end dates plus minimum and maximum trip length. Trip max can be lower than min; sweeps normalize the range when searching.
- Maximum stops filtering, defaulting new monitors to nonstop.
- Manual sweeps across every saved monitor.
- Top 4 priced fare results per monitor and across the latest sweep when running the local live-pricing server.
- Static hosting falls back to direct Google Flights search links when live pricing is unavailable.
- Monitor setup is saved locally and can be shared through an explicit share link without bundling historical sweep data.
- Opening a share link lets you combine the shared monitors with your local list or replace your local list.
- Saved sweep observations live locally in the browser and are keyed to the monitor setup.

## Run

Install the Python dependency, then run the local server:

```sh
python3 -m pip install -r requirements.txt
python3 server.py --port 8001
```

Then visit `http://127.0.0.1:8001`.

If you already have the project virtualenv, run:

```sh
.venv/bin/python server.py --port 8001
```

The server provides `/api/sweep` for live fare lookup and otherwise serves static files. Monitor setup plus sweep observations live in this browser's IndexedDB/localStorage cache. Share links include only monitor setup; after a link is imported or dismissed, the URL is cleaned up. If monitor setup changes meaningfully, previous sweep data no longer attaches to that monitor.

## Deploy

Deploy the app as one small Cloud Run service so the static dashboard and the Fli-powered `/api/sweep` endpoint stay together:

```sh
gcloud run deploy flight-tracker \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --concurrency 1 \
  --cpu 1 \
  --memory 512Mi \
  --cpu-throttling
```

Those settings keep the service inexpensive and limit abuse while the app is still personal/internal: it scales to zero when idle, runs only one container at a time, and handles one sweep request per container. Add a Google Cloud budget alert before sharing the URL broadly.

If you deploy from a prebuilt container instead of source, build and push this repository's `Dockerfile`, then deploy the image with the same Cloud Run limits.

The server caches live sweep results for matching monitor setups before applying rate limits, and also caches each route/date/duration provider query so small monitor edits can reuse recent results. Defaults are 6 hours of cached fare results, 12 uncached sweeps per browser client per hour, and 30 uncached sweeps per IP per hour. Tune them with:

```sh
gcloud run services update flight-tracker \
  --region us-central1 \
  --project flight-tracker-2606022310 \
  --set-env-vars SWEEP_CACHE_TTL_SECONDS=21600,MAX_SWEEPS_PER_CLIENT_WINDOW=12,MAX_SWEEPS_PER_IP_WINDOW=30,RATE_WINDOW_SECONDS=3600
```

## Data source

Local sweeps call the `flights` Python package, whose importable module is `fli`, from `server.py`. Fli queries Google Flights server-side and the app stores the returned fare prices and available carrier details in browser storage.

When `/api/sweep` is unavailable, such as on GitHub Pages, the app falls back to client-side Google Flights search links. That fallback cannot show live prices or airlines because Google Flights does not expose a browser-accessible public fare API.

## Tests

Run the travel-window logic tests with Node's built-in test runner:

```sh
node --test tests/travel-windows.test.js
```
