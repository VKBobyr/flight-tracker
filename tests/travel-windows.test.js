const assert = require("node:assert/strict");
const test = require("node:test");

const windows = require("../travel-windows.js");

function baseConfig(overrides = {}) {
  return {
    pairs: [{ origin: "SFO", destination: "SEA" }],
    startFrom: "2026-06-01",
    startTo: "2026-06-03",
    tripMin: 0,
    tripMax: 2,
    ...overrides,
  };
}

test("enumerates start dates inclusively", () => {
  assert.deepEqual(
    windows.enumerateDates("2026-06-01", "2026-06-03"),
    ["2026-06-01", "2026-06-02", "2026-06-03"],
  );
});

test("normalizes reversed date ranges before enumeration", () => {
  assert.deepEqual(
    windows.enumerateDates("2026-06-03", "2026-06-01"),
    ["2026-06-01", "2026-06-02", "2026-06-03"],
  );
});

test("caps enumerated start dates when requested", () => {
  assert.deepEqual(
    windows.enumerateDates("2026-06-01", "2026-06-10", { maxDates: 3 }),
    ["2026-06-01", "2026-06-02", "2026-06-03"],
  );
});

test("rejects invalid calendar dates", () => {
  assert.throws(() => windows.parseDateInput("2026-02-29"), /valid calendar date/);
  assert.throws(() => windows.parseDateInput("06/01/2026"), /YYYY-MM-DD/);
});

test("computes the maximum trip length from the date bounds", () => {
  assert.equal(windows.maxTripLengthForRange("2026-06-01", "2026-06-03"), 2);
  assert.equal(windows.maxTripLengthForRange("2026-06-03", "2026-06-01"), 2);
});

test("clamps trip lengths to whole non-negative days within date bounds", () => {
  assert.equal(windows.clampTripLength(-5, 7), 0);
  assert.equal(windows.clampTripLength(3.9, 7), 3);
  assert.equal(windows.clampTripLength(99, 7), 7);
  assert.equal(windows.clampTripLength("not a number", 7), 0);
});

test("normalizes reversed min/max trip lengths after clamping", () => {
  assert.deepEqual(
    windows.tripLengthBounds(7, 4, "2026-06-01", "2026-06-10"),
    { min: 4, max: 7, maxLength: 9 },
  );
});

test("clamps both trip bounds to the latest-end date", () => {
  assert.deepEqual(
    windows.tripLengthBounds(5, 9, "2026-06-01", "2026-06-03"),
    { min: 2, max: 2, maxLength: 2 },
  );
});

test("counts same-day trips as valid 0-day trips", () => {
  assert.equal(windows.countPossibleTrips(baseConfig({ tripMin: 0, tripMax: 0 })), 3);
});

test("counts only trips whose return date is on or before latest end", () => {
  assert.equal(windows.countPossibleTrips(baseConfig({ tripMin: 1, tripMax: 1 })), 2);
  assert.deepEqual(
    windows.enumeratePossibleTrips(baseConfig({ tripMin: 1, tripMax: 1 })).map((trip) => [
      trip.depart,
      trip.returnDate,
      trip.length,
    ]),
    [
      ["2026-06-01", "2026-06-02", 1],
      ["2026-06-02", "2026-06-03", 1],
    ],
  );
});

test("counts mixed 0-2 day windows with triangular latest-end pruning", () => {
  assert.equal(windows.countPossibleTrips(baseConfig({ tripMin: 0, tripMax: 2 })), 6);
});

test("gives the same count when trip min and max are reversed", () => {
  assert.equal(windows.countPossibleTrips(baseConfig({ tripMin: 2, tripMax: 0 })), 6);
});

test("clamps an over-large max length to the date bounds", () => {
  assert.equal(windows.countPossibleTrips(baseConfig({ tripMin: 0, tripMax: 99 })), 6);
});

test("uses the clamped minimum when both bounds exceed the date range", () => {
  assert.deepEqual(
    windows.enumeratePossibleTrips(baseConfig({ tripMin: 5, tripMax: 7 })),
    [{
      origin: "SFO",
      destination: "SEA",
      route: "SFO → SEA",
      depart: "2026-06-01",
      returnDate: "2026-06-03",
      length: 2,
    }],
  );
});

test("multiplies possible trips by unique airport pairs", () => {
  assert.equal(
    windows.countPossibleTrips(baseConfig({
      pairs: [
        { origin: "SFO", destination: "SEA" },
        { origin: "SJC", destination: "SEA" },
      ],
      tripMin: 0,
      tripMax: 1,
    })),
    10,
  );
});

test("normalizes, dedupes, and rejects invalid airport pairs", () => {
  assert.deepEqual(
    windows.normalizePairs([
      { origin: " sfo ", destination: " sea " },
      { origin: "SFO", destination: "SEA" },
      { origin: "SEA", destination: "SEA" },
      { origin: "", destination: "LAX" },
      { origin: "SJC", destination: "SEA" },
    ]),
    [
      { origin: "SFO", destination: "SEA" },
      { origin: "SJC", destination: "SEA" },
    ],
  );
});

test("returns no possible trips when there are no valid pairs", () => {
  assert.equal(
    windows.countPossibleTrips(baseConfig({
      pairs: [
        { origin: "SEA", destination: "SEA" },
        { origin: "", destination: "SEA" },
      ],
    })),
    0,
  );
});

test("ranks trips by departure date, length, route, then return date", () => {
  const ranked = windows.rankTrips([
    { route: "SJC → SEA", depart: "2026-06-01", returnDate: "2026-06-03", length: 2 },
    { route: "SFO → SEA", depart: "2026-06-01", returnDate: "2026-06-02", length: 1 },
    { route: "SJC → SEA", depart: "2026-05-31", returnDate: "2026-06-02", length: 2 },
    { route: "SFO → SEA", depart: "2026-06-01", returnDate: "2026-06-03", length: 2 },
  ]);
  assert.deepEqual(
    ranked.map((trip) => `${trip.depart}|${trip.length}|${trip.route}|${trip.returnDate}`),
    [
      "2026-05-31|2|SJC → SEA|2026-06-02",
      "2026-06-01|1|SFO → SEA|2026-06-02",
      "2026-06-01|2|SFO → SEA|2026-06-03",
      "2026-06-01|2|SJC → SEA|2026-06-03",
    ],
  );
});

test("handles leap-day windows correctly", () => {
  assert.deepEqual(
    windows.enumeratePossibleTrips(baseConfig({
      startFrom: "2028-02-28",
      startTo: "2028-03-01",
      tripMin: 1,
      tripMax: 2,
    })).map((trip) => [trip.depart, trip.returnDate, trip.length]),
    [
      ["2028-02-28", "2028-02-29", 1],
      ["2028-02-28", "2028-03-01", 2],
      ["2028-02-29", "2028-03-01", 1],
    ],
  );
});
