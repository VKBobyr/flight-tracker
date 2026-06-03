# Fareless

An elegant fare dashboard with locally saved trips, shareable trip setup links, and live Google Flights pricing through a local Fli-powered fare endpoint.

## Features

- Add multiple flexible trips at the same time.
- Add multiple airport pairs to the same trip.
- Fuzzy airport search by IATA code, airport name, city, or country.
- Fuzzy airline search for excluded airlines.
- Flexible earliest start and latest end dates plus minimum and maximum trip length. Trip max can be lower than min; fare searches normalize the range when searching.
- Maximum stops filtering, defaulting new trips to nonstop.
- Manual fare searches across every saved trip.
- Smart curated fare results per trip, grouped by the top four price levels with matching trip options inside each price group.
- Static hosting falls back to direct Google Flights search links when live pricing is unavailable.
- Trip setup is saved locally and can be shared through an explicit share link without bundling saved fare data.
- Opening a share link lets you combine the shared trips with your local list or replace your local list.
- Saved fare observations live locally in the browser and are keyed to the trip setup.

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

The server provides `/api/sweep` for live fare lookup and otherwise serves static files. Trip setup plus fare observations live in this browser's IndexedDB/localStorage cache. Share links include only trip setup; after a link is imported or dismissed, the URL is cleaned up. If trip setup changes meaningfully, previous fare data no longer attaches to that trip.

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

The server caches live fare results for matching trip setups before applying rate limits, and also caches each route/date/duration provider query so small trip edits can reuse recent results. Defaults are 6 hours of cached fare results, 12 uncached fare searches per browser client per hour, and 30 uncached fare searches per IP per hour. Tune them with:

```sh
gcloud run services update flight-tracker \
  --region us-central1 \
  --project flight-tracker-2606022310 \
  --set-env-vars SWEEP_CACHE_TTL_SECONDS=21600,MAX_SWEEPS_PER_CLIENT_WINDOW=12,MAX_SWEEPS_PER_IP_WINDOW=30,RATE_WINDOW_SECONDS=3600
```

## Security posture

The deployed Cloud Run service is public so shared dashboards and live fare searches can work without user accounts. The runtime service account should not have project-level IAM roles, and Cloud Run should stay constrained with `--max-instances 1` and `--concurrency 1` unless you add stronger abuse controls.

The app does not ship API keys to the browser. Fare requests go through `/api/sweep`, which validates JSON content type, limits request size, caps trip breadth, caches repeat searches, and applies in-process client/IP rate limits. Those limits reduce casual abuse but are not a hard billing cap: they reset on container restart and are not durable across multiple instances. For a public launch, put Cloud Armor or Firebase/App Check-style protection in front of the service, or require lightweight Google sign-in.

Local data files are intentionally excluded from git and Docker build contexts:

- `flight_tracker.sqlite`
- `flight_tracker.sqlite-*`
- `.env` / `.env.*`

## Data source

Live fare searches call the `flights` Python package, whose importable module is `fli`, from `server.py`. Fli queries Google Flights server-side and the app stores the returned fare prices and available carrier details in browser storage.

When `/api/sweep` is unavailable, such as on GitHub Pages, the app falls back to client-side Google Flights search links. That fallback cannot show live prices or airlines because Google Flights does not expose a browser-accessible public fare API.

## Tests

Run the travel-window logic tests with Node's built-in test runner:

```sh
node --test tests/travel-windows.test.js
```
