# Flight Tracker

A client-side flight search dashboard with locally saved monitors, shareable monitor setup links, and direct Google Flights search links.

## Features

- Add multiple route monitors at the same time.
- Add multiple airport pairs to the same monitor.
- Fuzzy airport search by IATA code, airport name, city, or country.
- Fuzzy airline search for excluded airlines.
- Flexible earliest start and latest end dates plus minimum and maximum trip length. Trip max can be lower than min; sweeps normalize the range when searching.
- Manual sweeps across every saved monitor.
- Top 5 Google Flights searches per monitor and across the latest sweep.
- Monitor setup is saved locally and can be shared through an explicit share link without bundling historical sweep data.
- Opening a share link lets you combine the shared monitors with your local list or replace your local list.
- Saved sweep observations live locally in the browser and are keyed to the monitor setup.

## Run

Run the local static server:

```sh
python3 server.py --port 8001
```

Then visit `http://127.0.0.1:8001`.

The Python server only serves static files. The app logic runs in the browser, and monitor setup plus sweep observations live in this browser's IndexedDB/localStorage cache. Share links include only monitor setup; after a link is imported or dismissed, the URL is cleaned up. If monitor setup changes meaningfully, previous sweep data no longer attaches to that monitor.

## Data source

Sweeps are client-side. They enumerate the possible route/date/day combinations in each monitor, rank a small set of useful searches, and link directly to Google Flights for the exact itinerary.

Because there is no backend or browser-accessible Google Flights API, the app does not scrape or store live fare prices. Prices and carrier details are checked on Google Flights after opening a generated search.

## Tests

Run the travel-window logic tests with Node's built-in test runner:

```sh
node --test tests/travel-windows.test.js
```
