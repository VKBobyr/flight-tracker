(function (root, factory) {
  const api = factory();
  root.TravelWindows = api;
  if (typeof module === "object" && module.exports) module.exports = api;
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const DAY_MS = 24 * 60 * 60 * 1000;
  const DEFAULT_MAX_ENUMERATED_DATES = 120;

  function toDateInput(date) {
    return date.toISOString().slice(0, 10);
  }

  function parseDateInput(value, label = "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
      throw new Error(`${label} must use YYYY-MM-DD`);
    }
    const date = new Date(`${value}T00:00:00`);
    if (!Number.isFinite(date.getTime()) || toDateInput(date) !== value) {
      throw new Error(`${label} must be a valid calendar date`);
    }
    return date;
  }

  function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function daysBetween(start, end) {
    return Math.round((parseDateInput(end, "end") - parseDateInput(start, "start")) / DAY_MS);
  }

  function normalizeDateRange(startFrom, startTo) {
    const start = parseDateInput(startFrom, "startFrom");
    const end = parseDateInput(startTo, "startTo");
    return start <= end
      ? { startFrom, startTo }
      : { startFrom: startTo, startTo: startFrom };
  }

  function maxTripLengthForRange(startFrom, startTo) {
    const range = normalizeDateRange(startFrom, startTo);
    return Math.max(0, daysBetween(range.startFrom, range.startTo));
  }

  function clampTripLength(value, maxLength) {
    const parsed = Number(value);
    const wholeDays = Number.isFinite(parsed) ? Math.trunc(parsed) : 0;
    return Math.min(Math.max(0, wholeDays), Math.max(0, Math.trunc(maxLength) || 0));
  }

  function tripLengthBounds(tripMin, tripMax, startFrom, startTo) {
    const maxLength = maxTripLengthForRange(startFrom, startTo);
    const min = clampTripLength(tripMin, maxLength);
    const max = clampTripLength(tripMax, maxLength);
    return {
      min: Math.min(min, max),
      max: Math.max(min, max),
      maxLength,
    };
  }

  function normalizePairs(pairs) {
    if (!Array.isArray(pairs)) return [];
    const seen = new Set();
    const normalized = [];
    pairs.forEach((pair) => {
      const origin = String(pair?.origin || "").trim().toUpperCase();
      const destination = String(pair?.destination || "").trim().toUpperCase();
      const key = `${origin}-${destination}`;
      if (!origin || !destination || origin === destination || seen.has(key)) return;
      seen.add(key);
      normalized.push({ origin, destination });
    });
    return normalized;
  }

  function enumerateDates(startFrom, startTo, options = {}) {
    const range = normalizeDateRange(startFrom, startTo);
    const maxDates = options.maxDates || DEFAULT_MAX_ENUMERATED_DATES;
    const dates = [];
    const cursor = parseDateInput(range.startFrom, "startFrom");
    const end = parseDateInput(range.startTo, "startTo");
    while (cursor <= end && dates.length < maxDates) {
      dates.push(toDateInput(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  function enumeratePossibleTrips(config, options = {}) {
    const range = normalizeDateRange(config.startFrom, config.startTo);
    const bounds = tripLengthBounds(config.tripMin, config.tripMax, range.startFrom, range.startTo);
    const pairs = normalizePairs(config.pairs);
    const starts = enumerateDates(range.startFrom, range.startTo, options);
    const latestEnd = parseDateInput(range.startTo, "startTo");
    const trips = [];

    pairs.forEach((pair) => {
      starts.forEach((depart) => {
        for (let length = bounds.min; length <= bounds.max; length += 1) {
          const returnDate = addDays(parseDateInput(depart, "depart"), length);
          if (returnDate > latestEnd) continue;
          trips.push({
            ...pair,
            route: `${pair.origin} → ${pair.destination}`,
            depart,
            returnDate: toDateInput(returnDate),
            length,
          });
        }
      });
    });

    return trips;
  }

  function countPossibleTrips(config, options = {}) {
    return enumeratePossibleTrips(config, options).length;
  }

  function rankTrips(trips) {
    return trips.slice().sort((a, b) => (
      a.depart.localeCompare(b.depart)
      || a.length - b.length
      || a.route.localeCompare(b.route)
      || a.returnDate.localeCompare(b.returnDate)
    ));
  }

  return {
    addDays,
    clampTripLength,
    countPossibleTrips,
    daysBetween,
    enumerateDates,
    enumeratePossibleTrips,
    maxTripLengthForRange,
    normalizeDateRange,
    normalizePairs,
    parseDateInput,
    rankTrips,
    toDateInput,
    tripLengthBounds,
  };
}));
