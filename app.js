"use strict";

const AIRPORTS = [
  ["ATL", "Hartsfield-Jackson Atlanta International", "Atlanta", "US"],
  ["AUS", "Austin-Bergstrom International", "Austin", "US"],
  ["BNA", "Nashville International", "Nashville", "US"],
  ["BOS", "Logan International", "Boston", "US"],
  ["BWI", "Baltimore/Washington International", "Baltimore", "US"],
  ["CLT", "Charlotte Douglas International", "Charlotte", "US"],
  ["DCA", "Ronald Reagan Washington National", "Washington", "US"],
  ["DEN", "Denver International", "Denver", "US"],
  ["DFW", "Dallas/Fort Worth International", "Dallas", "US"],
  ["DTW", "Detroit Metropolitan Wayne County", "Detroit", "US"],
  ["EWR", "Newark Liberty International", "Newark", "US"],
  ["FLL", "Fort Lauderdale-Hollywood International", "Fort Lauderdale", "US"],
  ["HNL", "Daniel K. Inouye International", "Honolulu", "US"],
  ["IAD", "Washington Dulles International", "Washington", "US"],
  ["IAH", "George Bush Intercontinental", "Houston", "US"],
  ["JFK", "John F. Kennedy International", "New York", "US"],
  ["LAS", "Harry Reid International", "Las Vegas", "US"],
  ["LAX", "Los Angeles International", "Los Angeles", "US"],
  ["LGA", "LaGuardia", "New York", "US"],
  ["MCO", "Orlando International", "Orlando", "US"],
  ["MDW", "Chicago Midway International", "Chicago", "US"],
  ["MIA", "Miami International", "Miami", "US"],
  ["MSP", "Minneapolis-Saint Paul International", "Minneapolis", "US"],
  ["ORD", "O'Hare International", "Chicago", "US"],
  ["PDX", "Portland International", "Portland", "US"],
  ["PHL", "Philadelphia International", "Philadelphia", "US"],
  ["PHX", "Phoenix Sky Harbor International", "Phoenix", "US"],
  ["SAN", "San Diego International", "San Diego", "US"],
  ["SEA", "Seattle-Tacoma International", "Seattle", "US"],
  ["SFO", "San Francisco International", "San Francisco", "US"],
  ["SJC", "San Jose Mineta International", "San Jose", "US"],
  ["SLC", "Salt Lake City International", "Salt Lake City", "US"],
  ["TPA", "Tampa International", "Tampa", "US"],
  ["YVR", "Vancouver International", "Vancouver", "CA"],
  ["YYZ", "Toronto Pearson International", "Toronto", "CA"],
  ["MEX", "Mexico City International", "Mexico City", "MX"],
  ["CUN", "Cancun International", "Cancun", "MX"],
  ["LHR", "Heathrow", "London", "GB"],
  ["LGW", "Gatwick", "London", "GB"],
  ["CDG", "Charles de Gaulle", "Paris", "FR"],
  ["ORY", "Paris Orly", "Paris", "FR"],
  ["AMS", "Amsterdam Schiphol", "Amsterdam", "NL"],
  ["FRA", "Frankfurt Airport", "Frankfurt", "DE"],
  ["MAD", "Adolfo Suarez Madrid-Barajas", "Madrid", "ES"],
  ["BCN", "Josep Tarradellas Barcelona-El Prat", "Barcelona", "ES"],
  ["FCO", "Leonardo da Vinci-Fiumicino", "Rome", "IT"],
  ["DUB", "Dublin Airport", "Dublin", "IE"],
  ["ZRH", "Zurich Airport", "Zurich", "CH"],
  ["NRT", "Narita International", "Tokyo", "JP"],
  ["HND", "Tokyo Haneda", "Tokyo", "JP"],
  ["ICN", "Incheon International", "Seoul", "KR"],
  ["SIN", "Singapore Changi", "Singapore", "SG"],
  ["SYD", "Sydney Kingsford Smith", "Sydney", "AU"],
  ["AKL", "Auckland Airport", "Auckland", "NZ"],
].map(([code, name, city, country]) => ({ code, name, city, country }));

const AIRLINES = [
  ["AA", "American Airlines"],
  ["AS", "Alaska Airlines"],
  ["B6", "JetBlue"],
  ["BA", "British Airways"],
  ["DL", "Delta Air Lines"],
  ["F9", "Frontier Airlines"],
  ["HA", "Hawaiian Airlines"],
  ["LH", "Lufthansa"],
  ["NK", "Spirit Airlines"],
  ["QF", "Qantas"],
  ["QR", "Qatar Airways"],
  ["SQ", "Singapore Airlines"],
  ["UA", "United Airlines"],
  ["VS", "Virgin Atlantic"],
  ["WN", "Southwest Airlines"],
].map(([code, name]) => ({ code, name }));

const STORAGE_KEY = "flight-tracker-state-v1";
const CLIENT_DB_NAME = "flight-tracker-client-db";
const CLIENT_DB_STORE = "state";
const CLIENT_DB_KEY = "default";
const CLIENT_ID_KEY = "flight-tracker-client-id-v1";
const MONITOR_URL_PARAM = "m";
const SWEEP_API_URL = "/api/sweep";
const TOP_DEAL_LIMIT = 4;
const FARE_ROWS_PER_PAGE = 10;
const AIRLINE_FALLBACK = "Airline unavailable";
const TravelWindowLogic = window.TravelWindows;

const state = loadLocalState();
const clientId = getClientId();
let clientDbPromise = null;
let pendingClientDbSave = Promise.resolve();
let sharedImportPrompted = false;
let activeSharedMonitors = [];
let pendingShareImportMonitors = [];
let editingMonitorId = null;
const fareViewState = new Map();
const draftPairs = [];
const draftExcludedAirlines = [];

const form = document.querySelector("#monitorForm");
const originInput = document.querySelector("#originInput");
const destinationInput = document.querySelector("#destinationInput");
const originCode = document.querySelector("#originCode");
const destinationCode = document.querySelector("#destinationCode");
const originSelected = document.querySelector("#originSelected");
const destinationSelected = document.querySelector("#destinationSelected");
const originSuggestions = document.querySelector("#originSuggestions");
const destinationSuggestions = document.querySelector("#destinationSuggestions");
const monitorGrid = document.querySelector("#monitorGrid");
const lastSweepAt = document.querySelector("#lastSweepAt");
const sweepProgress = document.querySelector("#sweepProgress");
const sweepProgressTitle = document.querySelector("#sweepProgressTitle");
const sweepProgressText = document.querySelector("#sweepProgressText");
const sweepProgressBar = document.querySelector("#sweepProgressBar");
const runAllButton = document.querySelector("#runAllButton");
const shareMonitorsButton = document.querySelector("#shareMonitorsButton");
const openCreateMonitorButton = document.querySelector("#openCreateMonitorButton");
const closeCreateMonitorButton = document.querySelector("#closeCreateMonitorButton");
const createMonitorOverlay = document.querySelector("#createMonitorOverlay");
const builderEyebrow = document.querySelector("#builderEyebrow");
const builderTitle = document.querySelector("#builderTitle");
const monitorSubmitButton = document.querySelector("#monitorSubmitButton");
const resetButton = document.querySelector("#resetButton");
const addPairButton = document.querySelector("#addPairButton");
const pairList = document.querySelector("#pairList");
const pairCount = document.querySelector("#pairCount");
const airlineInput = document.querySelector("#airlineInput");
const airlineCode = document.querySelector("#airlineCode");
const airlineSelected = document.querySelector("#airlineSelected");
const airlineSuggestions = document.querySelector("#airlineSuggestions");
const addAirlineButton = document.querySelector("#addAirlineButton");
const airlineList = document.querySelector("#airlineList");
const airlineCount = document.querySelector("#airlineCount");
const airlineFieldLabel = document.querySelector("#airlineFieldLabel");
const airlineModeInputs = document.querySelectorAll('input[name="airlineMode"]');
const tripLengthModeInputs = document.querySelectorAll('input[name="tripLengthMode"]');
const tripMinInput = document.querySelector("#tripMin");
const tripMaxInput = document.querySelector("#tripMax");
const maxStopsInput = document.querySelector("#maxStops");
const startFromInput = document.querySelector("#startFrom");
const startToInput = document.querySelector("#startTo");
const maxTripLengthButton = document.querySelector("#maxTripLengthButton");
const stepperButtons = document.querySelectorAll("[data-step-target]");
const sweepState = {
  isSweeping: false,
  total: 0,
  completed: 0,
  activeMonitorId: null,
};

initializeDates();
bindAirportSearch(originInput, originCode, originSelected, originSuggestions);
bindAirportSearch(destinationInput, destinationCode, destinationSelected, destinationSuggestions);
bindAirlineSearch(airlineInput, airlineCode, airlineSelected, airlineSuggestions);

form.addEventListener("submit", saveMonitorFromForm);
form.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.defaultPrevented) {
    event.preventDefault();
  }
});
shareMonitorsButton.addEventListener("click", shareMonitors);
openCreateMonitorButton.addEventListener("click", openCreateMonitorOverlay);
closeCreateMonitorButton.addEventListener("click", closeCreateMonitorOverlay);
createMonitorOverlay.addEventListener("click", (event) => {
  if (event.target === createMonitorOverlay) closeCreateMonitorOverlay();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && createMonitorOverlay.classList.contains("is-open")) {
    closeCreateMonitorOverlay();
  }
  if (event.key === "Escape" && pendingShareImportMonitors.length) {
    dismissSharedImport();
  }
  if (event.key === "Escape") {
    closeOpenMonitorMenus();
    closeOpenFareFilters();
  }
});
document.addEventListener("click", (event) => {
  document.querySelectorAll(".monitor-menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute("open");
  });
  closeFareFiltersOnOutsideClick(event);
});
resetButton.addEventListener("click", () => {
  setTimeout(() => {
    resetMonitorForm();
  }, 0);
});
addPairButton.addEventListener("click", addDraftPair);
addAirlineButton.addEventListener("click", addDraftExcludedAirline);
stepperButtons.forEach((button) => button.addEventListener("click", handleStepperClick));
maxTripLengthButton.addEventListener("click", setTripMaxToDateBounds);
tripMinInput.addEventListener("input", updateTripLengthModeUi);
tripMaxInput.addEventListener("input", clampTripLengthsToDateBounds);
startFromInput.addEventListener("change", updateTripLengthModeUi);
startToInput.addEventListener("change", updateTripLengthModeUi);
tripLengthModeInputs.forEach((input) => input.addEventListener("change", updateTripLengthModeUi));
airlineModeInputs.forEach((input) => input.addEventListener("change", renderDraftExcludedAirlines));
runAllButton.addEventListener("click", () => runSweepForAll(true));

renderDraftPairs();
renderDraftExcludedAirlines();
clampTripLengthsToDateBounds();
updateTripLengthModeUi();
render();
setTimeout(promptForSharedMonitors, 0);
hydrateStateFromClientDb();

function loadLocalState() {
  try {
    const storedState = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return normalizeState({
      monitors: storedState?.monitors || [],
      sweepData: storedState?.sweepData || sweepDataFromLegacyMonitors(storedState?.monitors),
      lastSweepAt: storedState?.lastSweepAt,
    });
  } catch (error) {
    console.warn("Could not load saved Fareless state.", error);
  }
  return normalizeState({ monitors: [], sweepData: {}, lastSweepAt: null });
}

function saveState() {
  state.monitors = state.monitors.map(normalizeMonitor);
  state.monitors.forEach(updateSweepStorageForMonitor);
  const snapshot = JSON.stringify(storageState(state));
  localStorage.setItem(STORAGE_KEY, snapshot);
  queueClientDbSave(snapshot);
}

async function hydrateStateFromClientDb() {
  try {
    const storedState = await readClientState();
    if (!storedState) {
      saveState();
      promptForSharedMonitors();
      return;
    }
    const normalized = normalizeState({
      ...storedState,
      monitors: storedState.monitors || state.monitors,
      sweepData: storedState.sweepData || sweepDataFromLegacyMonitors(storedState.monitors),
    });
    if (!normalized.monitors.length && state.monitors.length) {
      saveState();
      promptForSharedMonitors();
      return;
    }
    replaceState(normalized);
    saveState();
    render();
    promptForSharedMonitors();
  } catch (error) {
    console.warn("Could not load IndexedDB Fareless state.", error);
    promptForSharedMonitors();
  }
}

function queueClientDbSave(snapshot) {
  pendingClientDbSave = pendingClientDbSave
    .catch(() => {})
    .then(() => writeClientState(snapshot));
}

async function readClientState() {
  if (!("indexedDB" in window)) return null;
  const database = await openClientDb();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CLIENT_DB_STORE, "readonly");
    const request = transaction.objectStore(CLIENT_DB_STORE).get(CLIENT_DB_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function writeClientState(snapshot) {
  if (!("indexedDB" in window)) return;
  const database = await openClientDb();
  const value = storageState(JSON.parse(snapshot));
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(CLIENT_DB_STORE, "readwrite");
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.objectStore(CLIENT_DB_STORE).put(value, CLIENT_DB_KEY);
  });
}

function openClientDb() {
  if (clientDbPromise) return clientDbPromise;
  clientDbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(CLIENT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(CLIENT_DB_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return clientDbPromise;
}

function replaceState(nextState) {
  const normalized = normalizeState(nextState);
  state.monitors = normalized.monitors;
  state.sweepData = normalized.sweepData;
  state.lastSweepAt = normalized.lastSweepAt;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(storageState(normalized)));
}

function storageState(value) {
  return {
    monitors: (value.monitors || []).map(shareableMonitorConfig),
    sweepData: value.sweepData || {},
    lastSweepAt: value.lastSweepAt || null,
  };
}

function sweepDataFromLegacyMonitors(monitors) {
  if (!Array.isArray(monitors)) return {};
  return sanitizeSweepData(monitors.reduce((records, monitor) => {
    const normalized = normalizeMonitor({ ...monitor });
    if (normalized.topDeals.length || normalized.lastRunAt) {
      records[normalized.configSignature] = {
        topDeals: normalized.topDeals.map(normalizeDeal),
        lastRunAt: normalized.lastRunAt,
        combinationCount: normalized.combinationCount,
      };
    }
    return records;
  }, {}));
}

function updateSweepStorageForMonitor(monitor) {
  normalizeMonitor(monitor);
  const hasSweepData = monitor.topDeals.length || monitor.lastRunAt;
  if (!hasSweepData) return;
  state.sweepData[monitor.configSignature] = {
    topDeals: monitor.topDeals.map(normalizeDeal),
    lastRunAt: monitor.lastRunAt,
    combinationCount: monitor.combinationCount,
  };
}

function attachStoredSweepData(monitor, sweepData) {
  monitor.configSignature = monitorConfigSignature(monitor);
  const record = sanitizeSweepRecord(sweepData[monitor.configSignature]);
  if (!record) {
    monitor.history = [];
    monitor.topDeals = [];
    monitor.lastRunAt = null;
    monitor.combinationCount = undefined;
    return monitor;
  }
  monitor.history = [];
  monitor.topDeals = Array.isArray(record.topDeals) ? record.topDeals.map(normalizeDeal) : [];
  monitor.lastRunAt = record.lastRunAt || null;
  monitor.combinationCount = record.combinationCount;
  return monitor;
}

function sanitizeSweepData(sweepData) {
  return Object.entries(sweepData || {}).reduce((records, [key, record]) => {
    const nextRecord = sanitizeSweepRecord(record);
    if (nextRecord) records[key] = nextRecord;
    return records;
  }, {});
}

function sanitizeSweepRecord(record) {
  if (!record || typeof record !== "object") return null;
  const topDeals = Array.isArray(record.topDeals) ? record.topDeals.map(normalizeDeal) : [];
  return {
    topDeals,
    lastRunAt: record.lastRunAt || null,
    combinationCount: record.combinationCount,
  };
}

function monitorConfigSignature(monitor) {
  const config = shareableMonitorConfig(normalizeMonitorShape({ ...monitor }));
  return JSON.stringify({
    ...config,
    pairs: config.pairs.slice().sort((a, b) => `${a.origin}-${a.destination}`.localeCompare(`${b.origin}-${b.destination}`)),
    excludedAirlines: config.excludedAirlines.slice().sort(),
    airlineMode: config.airlineMode,
    maxStops: config.maxStops,
  });
}

function normalizeMonitorShape(monitor) {
  if (!Array.isArray(monitor.pairs)) {
    monitor.pairs = monitor.origin && monitor.destination
      ? [{ origin: monitor.origin, destination: monitor.destination }]
      : [];
  }
  monitor.pairs = uniquePairs(monitor.pairs)
    .map((pair) => ({
      origin: String(pair.origin || "").trim().toUpperCase(),
      destination: String(pair.destination || "").trim().toUpperCase(),
    }))
    .filter((pair) => pair.origin && pair.destination && pair.origin !== pair.destination);
  monitor.excludedAirlines = Array.isArray(monitor.excludedAirlines)
    ? uniqueValues(monitor.excludedAirlines.map((code) => String(code || "").trim().toUpperCase()))
    : [];
  monitor.airlineMode = normalizeAirlineMode(monitor.airlineMode);
  monitor.startFrom = coerceDateInput(monitor.startFrom, TravelWindowLogic.toDateInput(TravelWindowLogic.addDays(new Date(), 30)));
  monitor.startTo = coerceDateInput(monitor.startTo, TravelWindowLogic.toDateInput(TravelWindowLogic.addDays(new Date(), 90)));
  if (new Date(`${monitor.startFrom}T00:00:00`) > new Date(`${monitor.startTo}T00:00:00`)) {
    [monitor.startFrom, monitor.startTo] = [monitor.startTo, monitor.startFrom];
  }
  const maxBound = TravelWindowLogic.maxTripLengthForRange(monitor.startFrom, monitor.startTo);
  monitor.tripMin = Math.min(Math.max(0, Math.trunc(Number(monitor.tripMin) || 0)), maxBound);
  monitor.tripMax = Math.min(Math.max(0, Math.trunc(Number(monitor.tripMax) || 0)), maxBound);
  monitor.maxStops = normalizeMaxStops(monitor.maxStops);
  return monitor;
}

function normalizeMaxStops(value) {
  const clean = String(value ?? "0").trim().toUpperCase();
  if (clean === "ANY") return "ANY";
  if (["0", "1", "2"].includes(clean)) return clean;
  const numeric = Number(clean);
  if (Number.isFinite(numeric)) return String(Math.min(Math.max(0, Math.trunc(numeric)), 2));
  return "0";
}

function coerceDateInput(value, fallback) {
  const candidate = String(value || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(candidate) && Number.isFinite(new Date(`${candidate}T00:00:00`).getTime())
    ? candidate
    : fallback;
}

function normalizeState(value) {
  const monitors = value && Array.isArray(value.monitors) ? value.monitors.map(normalizeMonitor) : [];
  const sweepData = sanitizeSweepData(value && value.sweepData && typeof value.sweepData === "object" ? value.sweepData : {});
  const sweepTime = value && value.lastSweepAt ? String(value.lastSweepAt) : null;
  monitors.forEach((monitor) => attachStoredSweepData(monitor, sweepData));
  return { monitors, sweepData, lastSweepAt: sweepTime };
}

function readMonitorsFromUrl() {
  const encoded = new URLSearchParams(window.location.search).get(MONITOR_URL_PARAM);
  if (!encoded) return null;
  try {
    const decoded = jsonFromBase64Url(encoded);
    return monitorsFromSharePayload(decoded);
  } catch (error) {
    console.warn("Could not read trip setup from URL.", error);
    return null;
  }
}

function buildShareUrl(monitors) {
  const url = new URL(window.location.href);
  const params = url.searchParams;
  const shareableMonitors = monitors.map(shareableMonitorConfig);
  if (shareableMonitors.length) {
    params.set(MONITOR_URL_PARAM, jsonToBase64Url(sharePayloadFromMonitors(shareableMonitors)));
  } else {
    params.delete(MONITOR_URL_PARAM);
  }
  url.search = params.toString();
  return url.toString();
}

function clearSharedMonitorUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has(MONITOR_URL_PARAM)) return;
  params.delete(MONITOR_URL_PARAM);
  const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
  window.history.replaceState(null, "", nextUrl);
}

function shareableMonitorConfig(monitor) {
  return {
    pairs: monitor.pairs,
    startFrom: monitor.startFrom,
    startTo: monitor.startTo,
    tripMin: monitor.tripMin,
    tripMax: monitor.tripMax,
    maxStops: monitor.maxStops,
    excludedAirlines: monitor.excludedAirlines,
    airlineMode: normalizeAirlineMode(monitor.airlineMode),
  };
}

function sharePayloadFromMonitors(monitors) {
  return {
    v: 2,
    m: monitors.map((monitor) => [
      monitor.pairs.map((pair) => [pair.origin, pair.destination]),
      monitor.startFrom,
      monitor.startTo,
      monitor.tripMin,
      monitor.tripMax,
      monitor.maxStops,
      monitor.excludedAirlines,
      normalizeAirlineMode(monitor.airlineMode),
    ]),
  };
}

function monitorsFromSharePayload(payload) {
  if (Array.isArray(payload?.monitors)) return payload.monitors;
  if (payload?.v !== 2 || !Array.isArray(payload.m)) return null;
  return payload.m.map(([pairs, startFrom, startTo, tripMin, tripMax, sixth, seventh, eighth]) => {
    const hasMaxStops = !Array.isArray(sixth);
    const excludedAirlines = hasMaxStops ? seventh : sixth;
    const airlineMode = hasMaxStops ? eighth : "exclude";
    return {
      pairs: Array.isArray(pairs)
        ? pairs.map(([origin, destination]) => ({ origin, destination }))
        : [],
      startFrom,
      startTo,
      tripMin,
      tripMax,
      maxStops: hasMaxStops ? sixth : "0",
      excludedAirlines: Array.isArray(excludedAirlines) ? excludedAirlines : [],
      airlineMode: normalizeAirlineMode(airlineMode),
    };
  });
}

async function shareMonitors() {
  if (!state.monitors.length) {
    showToast("Add a trip before sharing.");
    return;
  }
  const shareUrl = buildShareUrl(state.monitors);
  try {
    if (!navigator.clipboard || !window.isSecureContext) throw new Error("Clipboard unavailable");
    await navigator.clipboard.writeText(shareUrl);
    confirmShareLinkCopied();
  } catch (error) {
    window.prompt("Copy this share link:", shareUrl);
    temporarilyConfirmShareButton("Link ready");
    showToast("Share link ready to copy.");
  }
}

function confirmShareLinkCopied() {
  temporarilyConfirmShareButton("Copied");
  showToast("Link copied.");
}

function temporarilyConfirmShareButton(label) {
  const copy = shareMonitorsButton.querySelector(".share-button-copy");
  const originalText = copy ? copy.textContent : shareMonitorsButton.textContent;
  if (copy) copy.textContent = label;
  else shareMonitorsButton.textContent = label;
  window.setTimeout(() => {
    if (copy) copy.textContent = originalText;
    else shareMonitorsButton.textContent = originalText;
  }, 1800);
}

function promptForSharedMonitors() {
  activeSharedMonitors = readMonitorsFromUrl() || [];
  if (sharedImportPrompted || !activeSharedMonitors.length) return;
  let incoming;
  try {
    incoming = normalizeState({ monitors: activeSharedMonitors, sweepData: state.sweepData }).monitors;
  } catch (error) {
    clearSharedMonitorUrl();
    showToast("Could not import that share link.");
    console.warn("Could not normalize shared monitors.", error);
    return;
  }
  if (!incoming.length) {
    clearSharedMonitorUrl();
    showToast("That share link did not include any valid trips.");
    return;
  }
  sharedImportPrompted = true;
  pendingShareImportMonitors = incoming;
  render();
}

function consumeSharedMonitors(mode) {
  const incoming = normalizeState({ monitors: activeSharedMonitors.length ? activeSharedMonitors : readMonitorsFromUrl() || [], sweepData: state.sweepData }).monitors;
  if (!incoming.length) {
    dismissSharedImport();
    return;
  }

  if (mode === "replace") {
    state.monitors = incoming;
    pruneSweepDataToMonitors(state.monitors);
  } else {
    state.monitors = mergeMonitorLists(state.monitors, incoming);
  }
  state.monitors = normalizeState({ monitors: state.monitors, sweepData: state.sweepData }).monitors;
  state.lastSweepAt = getLatestMonitorRunAt(state.monitors);
  closeSharedImportPrompt();
  clearSharedMonitorUrl();
  saveState();
  render();
  showToast(mode === "replace"
    ? `Replaced with ${formatTripCount(incoming.length)}.`
    : `Combined ${formatTripCount(incoming.length)} from the share link.`);
}

function dismissSharedImport() {
  closeSharedImportPrompt();
  clearSharedMonitorUrl();
    showToast("Kept your current trips.");
}

function closeSharedImportPrompt() {
  pendingShareImportMonitors = [];
  activeSharedMonitors = [];
  document.querySelector(".share-import-overlay")?.remove();
  document.body.classList.remove("modal-open");
}

function closeOpenMonitorMenus() {
  document.querySelectorAll(".monitor-menu[open]").forEach((menu) => menu.removeAttribute("open"));
}

function mergeMonitorLists(existing, incoming) {
  const merged = [];
  const seen = new Set();
  existing.concat(incoming).forEach((monitor) => {
    const normalized = normalizeMonitor({ ...monitor });
    if (seen.has(normalized.configSignature)) return;
    seen.add(normalized.configSignature);
    merged.push(normalized);
  });
  return merged;
}

function pruneSweepDataToMonitors(monitors) {
  const signatures = new Set(monitors.map((monitor) => normalizeMonitor(monitor).configSignature));
  state.sweepData = Object.fromEntries(
    Object.entries(state.sweepData || {}).filter(([signature]) => signatures.has(signature)),
  );
}

function getLatestMonitorRunAt(monitors) {
  return monitors
    .map((monitor) => monitor.lastRunAt)
    .filter(Boolean)
    .sort((a, b) => new Date(b) - new Date(a))[0] || null;
}

function jsonToBase64Url(value) {
  return base64UrlEncode(asciiBytes(JSON.stringify(value)));
}

function jsonFromBase64Url(value) {
  const bytes = base64UrlDecode(String(value));
  let json = "";
  bytes.forEach((byte) => {
    json += String.fromCharCode(byte);
  });
  return JSON.parse(json);
}

function initializeDates() {
  const today = new Date();
  const startFrom = TravelWindowLogic.addDays(today, 30);
  const startTo = TravelWindowLogic.addDays(today, 90);
  startFromInput.value = TravelWindowLogic.toDateInput(startFrom);
  startToInput.value = TravelWindowLogic.toDateInput(startTo);
}

function bindAirportSearch(input, codeField, selectedText, menu) {
  const selectAirport = (airport) => {
    input.value = `${airport.code} - ${airport.city}`;
    codeField.value = airport.code;
    selectedText.textContent = `${airport.name}, ${airport.city}, ${airport.country}`;
    menu.classList.remove("is-open");
  };

  input.addEventListener("input", () => {
    codeField.value = "";
    selectedText.textContent = "No airport selected";
    renderSuggestions(input.value, menu, selectAirport);
  });

  input.addEventListener("focus", () => renderSuggestions(input.value, menu, selectAirport));

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const topMatch = findAirports(input.value)[0];
    if (topMatch) selectAirport(topMatch);
    if (input === originInput) {
      destinationInput.focus();
      return;
    }
    if (originCode.value && destinationCode.value) {
      addDraftPair();
    }
    originInput.focus();
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== input) {
      menu.classList.remove("is-open");
    }
  });
}

function bindAirlineSearch(input, codeField, selectedText, menu) {
  input.addEventListener("input", () => {
    codeField.value = "";
    selectedText.textContent = "No airline selected";
    renderAirlineSuggestions(input.value, menu, (airline) => {
      setAirline(airline);
      menu.classList.remove("is-open");
    });
  });

  input.addEventListener("focus", () => renderAirlineSuggestions(input.value, menu, (airline) => {
    setAirline(airline);
    menu.classList.remove("is-open");
  }));

  input.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const topMatch = findAirlines(input.value)[0];
    if (topMatch) setAirline(topMatch);
    if (airlineCode.value || topMatch) {
      addDraftExcludedAirline();
    }
  });

  document.addEventListener("click", (event) => {
    if (!menu.contains(event.target) && event.target !== input) {
      menu.classList.remove("is-open");
    }
  });
}

function renderSuggestions(query, menu, onSelect) {
  const matches = findAirports(query).slice(0, 7);
  menu.innerHTML = "";

  if (!matches.length) {
    menu.classList.remove("is-open");
    return;
  }

  matches.forEach((airport) => {
    const option = document.createElement("button");
    option.className = "suggestion";
    option.type = "button";
    option.setAttribute("role", "option");
    option.innerHTML = `
      <span class="suggestion-code">${airport.code}</span>
      <span>
        <span class="suggestion-name">${airport.name}</span>
        <span class="suggestion-city">${airport.city}, ${airport.country}</span>
      </span>
    `;
    option.addEventListener("click", () => onSelect(airport));
    menu.appendChild(option);
  });

  menu.classList.add("is-open");
}

function renderAirlineSuggestions(query, menu, onSelect) {
  const matches = findAirlines(query).slice(0, 7);
  menu.innerHTML = "";

  if (!matches.length) {
    menu.classList.remove("is-open");
    return;
  }

  matches.forEach((airline) => {
    const option = document.createElement("button");
    option.className = "suggestion";
    option.type = "button";
    option.setAttribute("role", "option");
    option.innerHTML = `
      <span class="suggestion-code">${airline.code}</span>
      <span>
        <span class="suggestion-name">${airline.name}</span>
        <span class="suggestion-city">Airline</span>
      </span>
    `;
    option.addEventListener("click", () => onSelect(airline));
    menu.appendChild(option);
  });

  menu.classList.add("is-open");
}

function findAirports(query) {
  const normalized = normalize(query);
  if (!normalized) {
    return AIRPORTS.slice(0, 7);
  }

  return AIRPORTS
    .map((airport) => ({ airport, score: airportScore(airport, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.airport.code.localeCompare(b.airport.code))
    .map((entry) => entry.airport);
}

function findAirlines(query) {
  const normalized = normalize(query);
  if (!normalized) {
    return AIRLINES.slice(0, 7);
  }

  return AIRLINES
    .map((airline) => ({ airline, score: airlineScore(airline, normalized) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.airline.code.localeCompare(b.airline.code))
    .map((entry) => entry.airline);
}

function airportScore(airport, query) {
  const fields = [airport.code, airport.city, airport.name, airport.country].map(normalize);
  let score = 0;
  fields.forEach((field, index) => {
    if (field === query) score += 100 - index;
    if (field.startsWith(query)) score += 70 - index;
    if (field.includes(query)) score += 35 - index;
    if (isSubsequence(query, field)) score += 18 - index;
  });
  return score;
}

function airlineScore(airline, query) {
  const fields = [airline.code, airline.name].map(normalize);
  let score = 0;
  fields.forEach((field, index) => {
    if (field === query) score += 100 - index;
    if (field.startsWith(query)) score += 70 - index;
    if (field.includes(query)) score += 35 - index;
    if (isSubsequence(query, field)) score += 18 - index;
  });
  return score;
}

function normalize(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSubsequence(needle, haystack) {
  let cursor = 0;
  for (const character of haystack) {
    if (character === needle[cursor]) cursor += 1;
    if (cursor === needle.length) return true;
  }
  return false;
}

async function saveMonitorFromForm(event) {
  event.preventDefault();
  const formMonitor = readMonitorForm();
  if (!formMonitor) return;

  if (editingMonitorId) {
    const index = state.monitors.findIndex((monitor) => monitor.id === editingMonitorId);
    if (index < 0) {
      showToast("That trip is no longer available.");
      closeCreateMonitorOverlay();
      return;
    }
    const existing = normalizeMonitor(state.monitors[index]);
    const previousSignature = existing.configSignature;
    const nextMonitor = normalizeMonitor({
      ...existing,
      ...formMonitor,
      id: existing.id,
      createdAt: existing.createdAt,
    });
    if (previousSignature !== nextMonitor.configSignature) {
      delete state.sweepData[previousSignature];
      nextMonitor.lastRunAt = null;
      nextMonitor.topDeals = [];
      nextMonitor.combinationCount = undefined;
    }
    state.monitors[index] = nextMonitor;
    saveState();
    render();
    closeCreateMonitorOverlay();
    showToast(`Updated ${formatMonitorRoutes(nextMonitor)}.`);
    if (previousSignature !== nextMonitor.configSignature) {
      await runSweepForMonitor(nextMonitor.id);
    }
    return;
  }

  const monitor = normalizeMonitor({
    ...formMonitor,
    id: makeId(),
    createdAt: new Date().toISOString(),
    lastRunAt: null,
    history: [],
    topDeals: [],
  });
  state.monitors.unshift(monitor);
  saveState();
  render();
  resetMonitorForm();
  closeCreateMonitorOverlay();
  showToast(`Added ${formatPairCount(monitor.pairs.length)}.`);
}

function openCreateMonitorOverlay() {
  editingMonitorId = null;
  setMonitorOverlayMode("create");
  resetMonitorForm();
  createMonitorOverlay.hidden = false;
  createMonitorOverlay.classList.add("is-open");
  createMonitorOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  originInput.focus({ preventScroll: true });
}

function openEditMonitorOverlay(id) {
  const monitor = state.monitors.find((entry) => entry.id === id);
  if (!monitor) return;
  editingMonitorId = id;
  setMonitorOverlayMode("edit");
  fillMonitorForm(normalizeMonitor(monitor));
  createMonitorOverlay.hidden = false;
  createMonitorOverlay.classList.add("is-open");
  createMonitorOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
  originInput.focus({ preventScroll: true });
}

function closeCreateMonitorOverlay() {
  createMonitorOverlay.classList.remove("is-open");
  createMonitorOverlay.setAttribute("aria-hidden", "true");
  createMonitorOverlay.hidden = true;
  document.body.classList.remove("modal-open");
  editingMonitorId = null;
  setMonitorOverlayMode("create");
  openCreateMonitorButton.focus();
}

function setMonitorOverlayMode(mode) {
  const isEdit = mode === "edit";
  builderEyebrow.textContent = isEdit ? "Edit trip" : "Create trip";
  builderTitle.textContent = isEdit ? "Update route and dates" : "Route and dates";
  monitorSubmitButton.textContent = isEdit ? "Save changes" : "Add trip";
  closeCreateMonitorButton.setAttribute("aria-label", isEdit ? "Close edit trip" : "Close create trip");
}

function resetMonitorForm() {
  form.reset();
  setCheckedRadio(tripLengthModeInputs, "range");
  setCheckedRadio(airlineModeInputs, "exclude");
  clearCurrentPair();
  clearCurrentAirline();
  draftPairs.length = 0;
  draftExcludedAirlines.length = 0;
  renderDraftPairs();
  renderDraftExcludedAirlines();
  initializeDates();
  clampTripLengthsToDateBounds();
  updateTripLengthModeUi();
}

function fillMonitorForm(monitor) {
  form.reset();
  clearCurrentPair();
  clearCurrentAirline();
  draftPairs.length = 0;
  draftPairs.push(...(monitor.pairs || []).map((pair) => ({ origin: pair.origin, destination: pair.destination })));
  draftExcludedAirlines.length = 0;
  draftExcludedAirlines.push(...(monitor.excludedAirlines || []));
  setCheckedRadio(airlineModeInputs, normalizeAirlineMode(monitor.airlineMode));
  startFromInput.value = monitor.startFrom;
  startToInput.value = monitor.startTo;
  tripMinInput.value = monitor.tripMin;
  tripMaxInput.value = monitor.tripMax;
  setCheckedRadio(tripLengthModeInputs, inferTripLengthMode(monitor));
  maxStopsInput.value = monitor.maxStops;
  renderDraftPairs();
  renderDraftExcludedAirlines();
  clampTripLengthsToDateBounds();
  updateTripLengthModeUi();
}

function readMonitorForm() {
  clampTripLengthsToDateBounds();
  const pairs = getMonitorPairsFromForm();
  const startFrom = startFromInput.value;
  const startTo = startToInput.value;
  const tripLengthMode = getCheckedRadioValue(tripLengthModeInputs, "range");
  const maxBound = getDateBoundTripMax();
  let tripMin = Number(tripMinInput.value);
  let tripMax = Number(tripMaxInput.value);
  if (tripLengthMode === "any") {
    tripMin = 0;
    tripMax = maxBound;
  } else if (tripLengthMode === "exact") {
    tripMax = tripMin;
  }
  const maxStops = normalizeMaxStops(maxStopsInput.value);
  const excludedAirlines = getExcludedAirlinesFromForm();
  const airlineMode = getCheckedRadioValue(airlineModeInputs, "exclude");

  if (!pairs.length) {
    showToast("Add at least one airport pair.");
    return null;
  }
  if (new Date(startFrom) > new Date(startTo)) {
    showToast("Latest end needs to be after earliest start.");
    return null;
  }
  if (tripMin < 0 || tripMax < 0) {
    showToast("Trip lengths need to be at least 0 days.");
    return null;
  }

  return {
    pairs,
    startFrom,
    startTo,
    tripMin,
    tripMax,
    maxStops,
    excludedAirlines,
    airlineMode,
  };
}

function getExcludedAirlinesFromForm() {
  const airlines = draftExcludedAirlines.slice();
  const code = airlineCode.value;
  if (code) airlines.push(code);
  return uniqueValues(airlines);
}

function getCheckedRadioValue(inputs, fallback) {
  return [...inputs].find((input) => input.checked)?.value || fallback;
}

function setCheckedRadio(inputs, value) {
  const normalizedValue = String(value || "");
  inputs.forEach((input) => {
    input.checked = input.value === normalizedValue;
  });
}

function inferTripLengthMode(monitor) {
  const maxBound = getDateBoundTripMax();
  if (Number(monitor.tripMin) === 0 && Number(monitor.tripMax) === maxBound) return "any";
  if (Number(monitor.tripMin) === Number(monitor.tripMax)) return "exact";
  return "range";
}

function updateTripLengthModeUi() {
  const mode = getCheckedRadioValue(tripLengthModeInputs, "range");
  document.querySelector(".trip-length-panel")?.setAttribute("data-mode", mode);
  tripMaxInput.disabled = mode !== "range";
  maxTripLengthButton.hidden = mode !== "range";
  const exact = mode === "exact";
  tripMinInput.setAttribute("aria-label", exact ? "Exact trip length" : "Minimum days");
  if (mode === "exact") tripMaxInput.value = tripMinInput.value;
  if (mode === "any") {
    tripMinInput.value = "0";
    tripMaxInput.value = getDateBoundTripMax();
  }
  clampTripLengthsToDateBounds();
}

function handleStepperClick(event) {
  const target = document.querySelector(`#${event.currentTarget.dataset.stepTarget}`);
  const step = Number(event.currentTarget.dataset.step);
  const current = Number(target.value) || 0;
  target.value = Math.max(0, current + step);
  updateTripLengthModeUi();
}

function setTripMaxToDateBounds() {
  tripMaxInput.value = getDateBoundTripMax();
  clampTripLengthsToDateBounds();
}

function clampTripLengthsToDateBounds() {
  const maxBound = getDateBoundTripMax();
  tripMinInput.max = String(maxBound);
  tripMaxInput.max = String(maxBound);
  tripMinInput.value = clampDayValue(tripMinInput.value, maxBound);
  tripMaxInput.value = clampDayValue(tripMaxInput.value, maxBound);
}

function clampDayValue(value, maxBound) {
  return String(TravelWindowLogic.clampTripLength(value, maxBound));
}

function getDateBoundTripMax() {
  if (!startFromInput.value || !startToInput.value) return 0;
  return TravelWindowLogic.maxTripLengthForRange(startFromInput.value, startToInput.value);
}

function addDraftExcludedAirline() {
  const code = airlineCode.value;
  if (!code) {
    showToast("Choose an airline from the fuzzy search results.");
    return;
  }
  draftExcludedAirlines.splice(0, draftExcludedAirlines.length, ...uniqueValues(draftExcludedAirlines.concat(code)));
  clearCurrentAirline();
  renderDraftExcludedAirlines();
}

function renderDraftExcludedAirlines() {
  const mode = getCheckedRadioValue(airlineModeInputs, "exclude");
  const isInclude = mode === "include";
  airlineFieldLabel.textContent = isInclude ? "Only these airlines" : "Exclude airlines";
  airlineCount.textContent = draftExcludedAirlines.length
    ? `${draftExcludedAirlines.length} ${draftExcludedAirlines.length === 1 ? "airline" : "airlines"} ${isInclude ? "selected" : "excluded"}`
    : (isInclude ? "Any airline" : "0 excluded");
  airlineList.innerHTML = "";
  if (!draftExcludedAirlines.length) return;
  draftExcludedAirlines.forEach((code, index) => {
    const airline = getAirline(code);
    const row = document.createElement("div");
    row.className = "pair-chip";
    row.innerHTML = `<span>${airline.code} · ${airline.name}</span><button type="button" aria-label="Remove ${airline.name}">&times;</button>`;
    row.querySelector("button").addEventListener("click", () => {
      draftExcludedAirlines.splice(index, 1);
      renderDraftExcludedAirlines();
    });
    airlineList.appendChild(row);
  });
}

function clearCurrentAirline() {
  airlineInput.value = "";
  airlineCode.value = "";
  airlineSelected.textContent = "No airline selected";
}

function setAirline(airline) {
  airlineInput.value = `${airline.code} - ${airline.name}`;
  airlineCode.value = airline.code;
  airlineSelected.textContent = airline.name;
}

function getMonitorPairsFromForm() {
  const pairs = draftPairs.slice();
  const origin = originCode.value;
  const destination = destinationCode.value;
  if (origin || destination) {
    const pair = readCurrentPair();
    if (!pair) return [];
    pairs.push(pair);
  }
  return uniquePairs(pairs);
}

function addDraftPair() {
  const pair = readCurrentPair();
  if (!pair) return;
  const nextPairs = uniquePairs(draftPairs.concat(pair));
  draftPairs.length = 0;
  draftPairs.push(...nextPairs);
  clearCurrentPair();
  renderDraftPairs();
}

function readCurrentPair() {
  const origin = originCode.value;
  const destination = destinationCode.value;

  if (!origin || !destination) {
    showToast("Choose both airports from the fuzzy search results.");
    return null;
  }
  if (origin === destination) {
    showToast("Pick two different airports.");
    return null;
  }
  return { origin, destination };
}

function uniquePairs(pairs) {
  const seen = new Set();
  return pairs.filter((pair) => {
    const key = `${pair.origin}-${pair.destination}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean))];
}

function renderDraftPairs() {
  pairCount.textContent = `${draftPairs.length} ${draftPairs.length === 1 ? "pair" : "pairs"} added`;
  pairList.innerHTML = "";
  if (!draftPairs.length) return;
  draftPairs.forEach((pair, index) => {
    const row = document.createElement("div");
    row.className = "pair-chip";
    row.innerHTML = `<span>${pair.origin} → ${pair.destination}</span><button type="button" aria-label="Remove ${pair.origin} to ${pair.destination}">&times;</button>`;
    row.querySelector("button").addEventListener("click", () => {
      draftPairs.splice(index, 1);
      renderDraftPairs();
    });
    pairList.appendChild(row);
  });
}

function clearCurrentPair() {
  originInput.value = "";
  destinationInput.value = "";
  originCode.value = "";
  destinationCode.value = "";
  originSelected.textContent = "No airport selected";
  destinationSelected.textContent = "No airport selected";
}

async function runSweepForAll(manual) {
  if (!state.monitors.length) {
    showToast("Add at least one trip first.");
    return;
  }
  if (sweepState.isSweeping) {
    showToast("Fare search is already running.");
    return;
  }

  const monitors = state.monitors.slice();
  startSweepProgress(monitors.length);
  render();
  try {
    for (const monitor of monitors) {
      setActiveSweepMonitor(monitor.id);
      updateSweepProgress(`Checking ${formatMonitorRoutes(normalizeMonitor(monitor))}`);
      await runSweep(monitor.id, manual, { deferRender: true });
      completeSweepProgressStep();
    }

    state.lastSweepAt = new Date().toISOString();
    saveState();
    finishSweepProgress();
    render();
    showToast("Fares ready.");
  } catch (error) {
    finishSweepProgress();
    render();
    showToast(error.message || "Fare search failed.");
    throw error;
  }
}

async function runSweepForMonitor(monitorId) {
  if (sweepState.isSweeping) {
    showToast("Fare search is already running.");
    return;
  }
  startSweepProgress(1);
  render();
  try {
    setActiveSweepMonitor(monitorId);
    const monitor = state.monitors.find((entry) => entry.id === monitorId);
    updateSweepProgress(`Checking ${monitor ? formatMonitorRoutes(normalizeMonitor(monitor)) : "trip"}`);
    await runSweep(monitorId, true, { deferRender: true });
    completeSweepProgressStep();
    state.lastSweepAt = new Date().toISOString();
    saveState();
    finishSweepProgress();
    render();
    showToast("Fares ready.");
  } catch (error) {
    finishSweepProgress();
    render();
    showToast(error.message || "Fare search failed.");
  }
}

async function runSweep(monitorId, manual, options = {}) {
  const monitor = state.monitors.find((entry) => entry.id === monitorId);
  if (!monitor) return false;
  normalizeMonitor(monitor);

  const sweep = await fetchPricedSweep(monitor);
  if (!sweep.topDeals.length) {
    showToast("No priced fares found for this trip.");
    return false;
  }
  monitor.lastRunAt = sweep.ranAt;
  monitor.topDeals = sweep.topDeals.slice(0, TOP_DEAL_LIMIT).map(normalizeDeal);
  monitor.combinationCount = sweep.combinationCount;
  updateSweepStorageForMonitor(monitor);
  if (sweep.provider === "client") {
    showToast("Live pricing is unavailable here. Showing Google Flights searches instead.");
  }
  if (sweep.cacheStatus === "hit") {
    showToast("Reused recent fare results for this trip.");
  }
  if (Array.isArray(sweep.providerErrors) && sweep.providerErrors.length) {
    showToast(`${formatInteger(sweep.providerErrors.length)} live fare ${sweep.providerErrors.length === 1 ? "search" : "searches"} returned partial data.`);
  }

  if (!options.deferRender) {
    saveState();
    render();
  }
  return true;
}

async function fetchPricedSweep(monitor) {
  try {
    const response = await fetch(SWEEP_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Flight-Tracker-Client": clientId,
      },
      body: JSON.stringify({ monitor }),
    });
    if (response.status === 429) {
      const payload = await response.json().catch(() => ({}));
    const error = new Error(payload.error || "Too many fare searches. Please wait a bit before trying again.");
      error.isRateLimit = true;
      throw error;
    }
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  } catch (error) {
    if (error.isRateLimit) throw error;
    console.warn("Live fare lookup unavailable; falling back to client search links.", error);
    return buildClientSweep(monitor);
  }
}

function getClientId() {
  try {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing) return existing;
    const generated = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(CLIENT_ID_KEY, generated);
    return generated;
  } catch (_error) {
    return "ephemeral-client";
  }
}

function buildClientSweep(monitor) {
  const ranAt = new Date().toISOString();
  const candidates = buildClientSearchCandidates(monitor);
  return {
    provider: "client",
    ranAt,
    topDeals: curateClientDeals(candidates, TOP_DEAL_LIMIT),
    candidateCount: candidates.length,
    combinationCount: countTravelWindows(monitor),
  };
}

function normalizeDeal(deal) {
  return {
    ...deal,
    price: hasPrice(deal.price) ? Number(deal.price) : null,
    currency: deal.currency || "USD",
    airlineName: normalizeAirlineName(deal.airlineName, deal.airlineCode),
    maxStops: normalizeMaxStops(deal.maxStops),
    stopCount: normalizeStopCount(deal.stopCount),
    sourceName: deal.sourceName || "Google Flights",
    sourceUrl: deal.sourceUrl || buildGoogleFlightsUrlFromDeal(deal),
    provider: deal.provider || "client",
    dealReason: String(deal.dealReason || "").trim(),
    dealHighlight: String(deal.dealHighlight || "").trim(),
    fareOptions: Array.isArray(deal.fareOptions) ? deal.fareOptions.map(normalizeRelatedDeal) : fareOptionsFromLegacyDeal(deal),
    fareOptionTotal: Math.max(0, Math.trunc(Number(deal.fareOptionTotal) || 0)),
  };
}

function fareOptionsFromLegacyDeal(deal) {
  const lead = normalizeRelatedDeal(deal);
  const legacyMatches = Array.isArray(deal.samePriceMatches) ? deal.samePriceMatches.map(normalizeRelatedDeal) : [];
  return [lead, ...legacyMatches].filter((option) => option.origin || option.route);
}

function normalizeRelatedDeal(deal) {
  return {
    ...deal,
    airlineName: normalizeAirlineName(deal.airlineName, deal.airlineCode),
    maxStops: normalizeMaxStops(deal.maxStops),
    stopCount: normalizeStopCount(deal.stopCount),
    sourceUrl: deal.sourceUrl || buildGoogleFlightsUrlFromDeal(deal),
  };
}

function buildClientSearchCandidates(monitor) {
  normalizeMonitor(monitor);
  return TravelWindowLogic.rankTrips(TravelWindowLogic.enumeratePossibleTrips(monitor))
    .map((trip) => ({
      ...trip,
      price: null,
      currency: "USD",
      airlineName: AIRLINE_FALLBACK,
      maxStops: monitor.maxStops,
      stopCount: null,
      sourceName: "Google Flights",
      sourceUrl: buildGoogleFlightsUrl(trip.origin, trip.destination, trip.depart, trip.returnDate),
      provider: "client",
    }));
}

function startSweepProgress(total) {
  sweepState.isSweeping = true;
  sweepState.total = total;
  sweepState.completed = 0;
  sweepState.activeMonitorId = null;
  runAllButton.disabled = true;
  runAllButton.textContent = "Finding...";
  sweepProgress.hidden = false;
  updateSweepProgress("Preparing Google Flights searches");
}

function setActiveSweepMonitor(monitorId) {
  sweepState.activeMonitorId = monitorId;
  render();
}

function updateSweepProgress(message) {
  const percent = sweepState.total ? (sweepState.completed / sweepState.total) * 100 : 0;
  sweepProgressTitle.textContent = `Finding fares for ${formatInteger(sweepState.total)} ${sweepState.total === 1 ? "trip" : "trips"}`;
  sweepProgressText.textContent = `${formatInteger(sweepState.completed)} of ${formatInteger(sweepState.total)} complete · ${message}`;
  sweepProgressBar.style.width = `${percent}%`;
}

function completeSweepProgressStep() {
  sweepState.completed += 1;
  updateSweepProgress("Collecting results");
}

function finishSweepProgress() {
  sweepState.completed = sweepState.total;
  sweepState.activeMonitorId = null;
  updateSweepProgress("Fares ready");
  sweepProgressBar.style.width = "100%";
  runAllButton.disabled = false;
  runAllButton.textContent = "Find fares";
  setTimeout(() => {
    if (!sweepState.isSweeping) sweepProgress.hidden = true;
  }, 900);
  sweepState.isSweeping = false;
}

function compareDeals(a, b) {
  const aHasPrice = hasPrice(a.price);
  const bHasPrice = hasPrice(b.price);
  if (aHasPrice !== bHasPrice) return bHasPrice - aHasPrice;
  if (aHasPrice && bHasPrice && Number(a.price) !== Number(b.price)) {
    return Number(a.price) - Number(b.price);
  }
  return String(a.depart || "").localeCompare(String(b.depart || ""))
    || Number(a.length || 0) - Number(b.length || 0)
    || String(a.route || "").localeCompare(String(b.route || ""));
}

function curateClientDeals(candidates, limit = TOP_DEAL_LIMIT) {
  const priced = candidates.filter((deal) => hasPrice(deal.price));
  if (!priced.length) {
    return candidates.slice(0, limit).map((deal) => ({ ...deal, dealReason: "Direct search" }));
  }

  const labels = ["Lowest found", "Next lowest", "Third lowest", "Fourth lowest"];
  return groupDeals(priced, (deal) => String(Number(deal.price)))
    .sort((a, b) => Number(a.key) - Number(b.key))
    .slice(0, limit)
    .map((group, index) => {
      const options = group.deals.slice().sort(compareDeals);
      return {
        ...options[0],
        dealReason: labels[index] || "Also available",
        dealHighlight: index === 0 ? "primary" : "",
        fareOptions: options.map(compactFareOption),
        fareOptionTotal: options.length,
      };
    });
}

function groupDeals(deals, keyFn) {
  const groups = new Map();
  deals.forEach((deal) => {
    const key = String(keyFn(deal) || "").trim();
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(deal);
  });
  return [...groups.entries()].map(([key, groupDeals]) => ({
    key,
    deals: groupDeals,
    best: groupDeals.slice().sort(compareDeals)[0],
  }));
}

function compactFareOption(deal) {
  return {
    route: deal.route,
    origin: deal.origin,
    destination: deal.destination,
    depart: deal.depart,
    returnDate: deal.returnDate,
    length: deal.length,
    stopCount: deal.stopCount,
    maxStops: deal.maxStops,
    airlineName: deal.airlineName,
    airlineCode: deal.airlineCode,
    sourceUrl: deal.sourceUrl,
    price: deal.price,
    currency: deal.currency || "USD",
  };
}

function hasPrice(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function render() {
  const count = state.monitors.length;
  renderToolbarPriority(count);
  renderLastSweepAt();
  renderMonitors();
  renderShareImportOverlay();
}

function renderToolbarPriority(count) {
  const hasMonitors = count > 0;
  shareMonitorsButton.disabled = !hasMonitors;
  shareMonitorsButton.hidden = !hasMonitors;
  lastSweepAt.hidden = !hasMonitors;
  runAllButton.classList.toggle("primary-button", hasMonitors);
  runAllButton.classList.toggle("ghost-button", !hasMonitors);
  runAllButton.disabled = !hasMonitors || sweepState.isSweeping;
  runAllButton.hidden = !hasMonitors;
}

function renderLastSweepAt() {
  if (!lastSweepAt) return;
  lastSweepAt.textContent = state.lastSweepAt ? `Last found ${formatDateTime(state.lastSweepAt)}` : "No fares yet";
}

function normalizedFareOptions(deal) {
  const options = Array.isArray(deal.fareOptions) && deal.fareOptions.length
    ? deal.fareOptions
    : fareOptionsFromLegacyDeal(deal);
  return options.map(normalizeRelatedDeal).filter((option) => option.origin || option.route);
}

function renderFareExplorer(monitor, deals, isLoading = false) {
  const groups = displayFareGroups(deals);
  const entries = fareEntriesFromGroups(groups);
  const explorer = document.createElement("div");
  explorer.className = `fare-explorer${isLoading ? " is-loading" : ""}`;
  if (!entries.length) {
    if (isLoading) {
      explorer.appendChild(renderFareLoadingTable());
    } else {
      explorer.innerHTML = `<p class="empty-state">Find fares to show smart Google Flights suggestions for this trip.</p>`;
    }
    return explorer;
  }

  const view = getFareView(monitor.id);
  reconcileFareView(view, entries);
  const filteredEntries = filterFareEntries(entries, view);
  const sortedEntries = sortFareEntries(filteredEntries, view.sort);

  explorer.appendChild(renderFareControls(monitor.id, entries, view, filteredEntries.length));
  const table = document.createElement("div");
  table.className = "fare-table";
  if (!filteredEntries.length) {
    table.innerHTML = `<p class="empty-state">No fares match these filters.</p>`;
  } else {
    table.appendChild(renderFareTable(monitor.id, sortedEntries, view, isLoading));
  }
  explorer.appendChild(table);
  return explorer;
}

function renderFareLoadingTable() {
  const wrapper = document.createElement("div");
  wrapper.className = "fare-table-card fare-table-loading is-loading";
  wrapper.setAttribute("aria-label", "Finding fares");
  wrapper.innerHTML = `
    <div class="fare-table-head">
      <span>Trip</span>
      <span>Start</span>
      <span>End</span>
      <span>Days</span>
      <span>Total</span>
      <span>Airline</span>
      <span>Stops</span>
      <span>Price</span>
      <span aria-hidden="true"></span>
    </div>
    <div class="fare-table-body">
      ${Array.from({ length: 4 }, () => `
        <div class="fare-skeleton-row" aria-hidden="true">
          <span></span><span></span><span></span><span></span>
          <span></span><span></span><span></span><span></span><span></span>
        </div>
      `).join("")}
    </div>
  `;
  return wrapper;
}

function getFareView(monitorId) {
  if (!fareViewState.has(monitorId)) {
    fareViewState.set(monitorId, { sort: { column: "price", direction: "asc" }, page: 1, routes: new Set(), lengths: new Set(), airlines: new Set() });
  }
  return fareViewState.get(monitorId);
}

function reconcileFareView(view, entries) {
  if (!view.sort) view.sort = { column: "price", direction: view.priceSort || "asc" };
  delete view.priceSort;
  view.page = Math.max(1, Math.trunc(Number(view.page) || 1));
  if (!view.routes) view.routes = new Set();
  if (!view.lengths) view.lengths = new Set();
  if (!view.airlines) view.airlines = new Set();
  const routes = new Set(entries.map((entry) => entry.routeFilter).filter(Boolean));
  const lengths = new Set(entries.map((entry) => String(entry.length)));
  const airlines = new Set(entries.map((entry) => entry.airlineFilter).filter(Boolean));
  view.routes = new Set([...view.routes].filter((route) => routes.has(route)));
  view.lengths = new Set([...view.lengths].filter((length) => lengths.has(length)));
  view.airlines = new Set([...view.airlines].filter((airline) => airlines.has(airline)));
}

function fareEntriesFromGroups(groups) {
  return groups.flatMap((deal, bucketIndex) => {
    const options = normalizedFareOptions(deal);
    return options.map((option, optionIndex) => {
      const price = hasPrice(option.price) ? Number(option.price) : Number(deal.price);
      const route = option.route || `${option.origin} → ${option.destination}`;
      const airline = knownAirlineName(option.airlineName, option.airlineCode)
        || knownAirlineName(deal.airlineName, deal.airlineCode);
      return {
        ...option,
        price,
        currency: option.currency || deal.currency || "USD",
        route,
        routeFilter: route,
        sourceName: option.sourceName || deal.sourceName || "Google Flights",
        sourceUrl: buildGoogleFlightsUrlFromDeal(option) || option.sourceUrl || deal.sourceUrl || "https://www.google.com/travel/flights",
        airlineDisplay: airline,
        airlineFilter: airline,
        totalLength: totalTripLength(option.length),
        bucketIndex,
        optionIndex,
      };
    });
  });
}

function renderFareControls(monitorId, entries, view, visibleCount) {
  const controls = document.createElement("div");
  controls.className = "fare-controls";
  const lengths = [...new Set(entries.map((entry) => Number(entry.length)))]
    .filter((length) => Number.isFinite(length))
    .sort((a, b) => a - b);
  const routes = uniqueValues(entries.map((entry) => entry.routeFilter).filter(Boolean)).sort();
  const airlines = uniqueValues(entries.map((entry) => entry.airlineFilter).filter(Boolean)).sort();
  controls.innerHTML = `
    <div class="fare-count">${formatInteger(visibleCount)} of ${formatInteger(entries.length)} fares</div>
    ${renderFilterDropdownHtml("Airport pairs", "routes", routes.map((route) => ({ value: route, label: route })), view.routes)}
    ${renderFilterDropdownHtml("Trip length", "lengths", lengths.map((length) => ({ value: String(length), label: formatDayCount(length) })), view.lengths)}
    ${renderFilterDropdownHtml("Airlines", "airlines", airlines.map((airline) => ({ value: airline, label: airline })), view.airlines)}
    <button class="fare-reset" type="button" data-fare-reset>Reset</button>
  `;
  controls.querySelectorAll("[data-filter-kind]").forEach((input) => {
    input.addEventListener("change", () => {
      const targetSet = view[input.dataset.filterKind];
      if (input.checked) targetSet.add(input.value);
      else targetSet.delete(input.value);
      view.page = 1;
      render();
    });
  });
  controls.querySelectorAll(".fare-filter").forEach((filter) => {
    filter.addEventListener("toggle", () => {
      if (filter.open) closeOtherFareFilters(filter);
    });
  });
  controls.querySelector("[data-fare-reset]").addEventListener("click", () => {
    view.sort = { column: "price", direction: "asc" };
    view.page = 1;
    view.routes.clear();
    view.lengths.clear();
    view.airlines.clear();
    render();
  });
  return controls;
}

function closeFareFiltersOnOutsideClick(event) {
  if (event.target.closest(".fare-filter")) return;
  closeOpenFareFilters();
}

function closeOpenFareFilters() {
  document.querySelectorAll(".fare-filter[open]").forEach((filter) => {
    filter.open = false;
  });
}

function closeOtherFareFilters(activeFilter) {
  document.querySelectorAll(".fare-filter[open]").forEach((filter) => {
    if (filter !== activeFilter) filter.open = false;
  });
}

function renderFilterDropdownHtml(label, kind, options, selected) {
  if (!options.length) return "";
  const selectedText = selected.size ? `${selected.size} selected` : "All";
  return `
    <details class="fare-filter">
      <summary><span>${label}</span><strong>${selectedText}</strong></summary>
      <div class="fare-filter-menu">
        ${options.map((option) => `
          <label>
            <input type="checkbox" data-filter-kind="${kind}" value="${escapeAttribute(option.value)}" ${selected.has(option.value) ? "checked" : ""}>
            <span>${escapeHtml(option.label)}</span>
          </label>
        `).join("")}
      </div>
    </details>
  `;
}

function filterFareEntries(entries, view) {
  return entries.filter((entry) => (
    (!view.routes.size || view.routes.has(entry.routeFilter))
    && (!view.lengths.size || view.lengths.has(String(entry.length)))
    && (!view.airlines.size || view.airlines.has(entry.airlineFilter))
  ));
}

function sortFareEntries(entries, sort = { column: "price", direction: "asc" }) {
  const column = sort?.column || "price";
  const direction = sort?.direction === "desc" ? -1 : 1;
  return entries.slice().sort((a, b) => {
    const primary = compareFareEntryColumn(a, b, column);
    if (primary) return direction * primary;
    return compareFareEntryTiebreakers(a, b, column);
  });
}

function compareFareEntryPrice(a, b) {
  return Number(a.price || 0) - Number(b.price || 0)
    || String(a.depart || "").localeCompare(String(b.depart || ""))
    || Number(a.length || 0) - Number(b.length || 0)
    || String(a.route || "").localeCompare(String(b.route || ""));
}

function compareFareEntryColumn(a, b, column) {
  if (column === "start") return String(a.depart || "").localeCompare(String(b.depart || ""));
  if (column === "end") return String(a.returnDate || "").localeCompare(String(b.returnDate || ""));
  if (column === "length") return Number(a.length || 0) - Number(b.length || 0);
  if (column === "totalLength") return Number(a.totalLength || 0) - Number(b.totalLength || 0);
  return Number(a.price || 0) - Number(b.price || 0);
}

function compareFareEntryTiebreakers(a, b, column) {
  if (column !== "start") {
    const start = String(a.depart || "").localeCompare(String(b.depart || ""));
    if (start) return start;
  }
  if (column !== "price") {
    const price = Number(a.price || 0) - Number(b.price || 0);
    if (price) return price;
  }
  if (column !== "length") {
    const length = Number(a.length || 0) - Number(b.length || 0);
    if (length) return length;
  }
  if (column !== "totalLength") {
    const totalLength = Number(a.totalLength || 0) - Number(b.totalLength || 0);
    if (totalLength) return totalLength;
  }
  if (column !== "end") {
    const end = String(a.returnDate || "").localeCompare(String(b.returnDate || ""));
    if (end) return end;
  }
  return String(a.route || "").localeCompare(String(b.route || ""));
}

function renderFareTable(monitorId, entries, view, isLoading = false) {
  const wrapper = document.createElement("div");
  wrapper.className = `fare-table-card${isLoading ? " is-loading" : ""}`;
  const totalPages = Math.max(1, Math.ceil(entries.length / FARE_ROWS_PER_PAGE));
  view.page = Math.min(Math.max(1, Math.trunc(Number(view.page) || 1)), totalPages);
  const startIndex = (view.page - 1) * FARE_ROWS_PER_PAGE;
  const pageEntries = entries.slice(startIndex, startIndex + FARE_ROWS_PER_PAGE);
  wrapper.innerHTML = `
    <div class="fare-table-head">
      <span>Trip</span>
      ${renderSortHeader("start", "Start", view)}
      ${renderSortHeader("end", "End", view)}
      ${renderSortHeader("length", "Days", view)}
      ${renderSortHeader("totalLength", "Total", view)}
      <span>Airline</span>
      <span>Stops</span>
      ${renderSortHeader("price", "Price", view)}
      <span aria-hidden="true"></span>
    </div>
  `;
  const rows = document.createElement("div");
  rows.className = "fare-table-body";
  pageEntries.forEach((entry) => rows.appendChild(renderFareTableRow(entry)));
  wrapper.appendChild(rows);
  wrapper.querySelectorAll("[data-sort-column]").forEach((button) => {
    button.addEventListener("click", () => {
      const column = button.dataset.sortColumn;
      const viewState = getFareView(monitorId);
      const current = viewState.sort || { column: "price", direction: "asc" };
      const direction = current.column === column && current.direction === "asc" ? "desc" : "asc";
      viewState.sort = { column, direction };
      viewState.page = 1;
      render();
    });
  });
  if (entries.length > FARE_ROWS_PER_PAGE) {
    wrapper.appendChild(renderFarePagination(monitorId, view, entries.length, startIndex, pageEntries.length, totalPages));
  }
  return wrapper;
}

function renderFarePagination(monitorId, view, totalRows, startIndex, visibleRows, totalPages) {
  const pagination = document.createElement("div");
  pagination.className = "fare-pagination";
  const firstVisible = startIndex + 1;
  const lastVisible = startIndex + visibleRows;
  pagination.innerHTML = `
    <span>${formatInteger(firstVisible)}-${formatInteger(lastVisible)} of ${formatInteger(totalRows)}</span>
    <div>
      <button type="button" data-page-direction="previous" ${view.page <= 1 ? "disabled" : ""}>Previous</button>
      <span>Page ${formatInteger(view.page)} of ${formatInteger(totalPages)}</span>
      <button type="button" data-page-direction="next" ${view.page >= totalPages ? "disabled" : ""}>Next</button>
    </div>
  `;
  pagination.querySelectorAll("[data-page-direction]").forEach((button) => {
    button.addEventListener("click", () => {
      const viewState = getFareView(monitorId);
      viewState.page += button.dataset.pageDirection === "next" ? 1 : -1;
      render();
    });
  });
  return pagination;
}

function renderSortHeader(column, label, view) {
  const sort = view.sort || { column: "price", direction: "asc" };
  const indicator = sort.column === column ? (sort.direction === "desc" ? "↓" : "↑") : "";
  return `<button class="fare-sort-header" type="button" data-sort-column="${column}" aria-label="Sort by ${label.toLowerCase()}">${label}${indicator ? ` ${indicator}` : ""}</button>`;
}

function renderFareTableRow(entry) {
  const row = document.createElement("a");
  row.className = "fare-table-row";
  row.href = entry.sourceUrl;
  row.target = "_blank";
  row.rel = "noopener noreferrer";
  row.title = "Open this trip on Google Flights";
  row.innerHTML = `
    <strong>${escapeHtml(entry.route)}</strong>
    <span>${formatDate(entry.depart)}</span>
    <span>${formatDate(entry.returnDate)}</span>
    <span>${formatDayCount(entry.length)}</span>
    <span>${formatDayCount(entry.totalLength)}</span>
    <span>${entry.airlineDisplay ? escapeHtml(entry.airlineDisplay) : "&mdash;"}</span>
    <span>${formatDealStops(entry)}</span>
    <strong class="fare-row-price">${formatMoney(entry.price)}</strong>
    <em aria-label="Open in Google Flights">↗</em>
  `;
  return row;
}

function normalizeAirlineName(name, code) {
  const cleanName = String(name || "").trim();
  const cleanCode = String(code || "").trim();
  if (cleanName && cleanName !== "Check Google Flights for airline") return formatAirlineNames(cleanName.split(","));
  if (cleanCode) return cleanCode;
  return AIRLINE_FALLBACK;
}

function knownAirlineName(name, code) {
  const label = normalizeAirlineName(name, code);
  if (label === AIRLINE_FALLBACK || label === "Check Google Flights for airline") return "";
  return label;
}

function formatAirlineNames(names) {
  const compacted = [];
  names.map((name) => String(name || "").trim()).filter(Boolean).forEach((name) => {
    const matchIndex = compacted.findIndex((existing) => airlineNamesMatch(existing, name));
    if (matchIndex >= 0) {
      compacted[matchIndex] = preferredAirlineName(compacted[matchIndex], name);
    } else {
      compacted.push(name);
    }
  });
  return compacted.join(", ");
}

function airlineNamesMatch(first, second) {
  const firstKey = airlineNameKey(first);
  const secondKey = airlineNameKey(second);
  return Boolean(firstKey && firstKey === secondKey);
}

function airlineNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => !["air", "airline", "airlines", "airways", "lines"].includes(word))
    .join(" ");
}

function preferredAirlineName(first, second) {
  return first.length <= second.length ? first : second;
}

function buildGoogleFlightsUrlFromDeal(deal) {
  const [routeOrigin, routeDestination] = String(deal.route || "").split(" → ");
  const origin = deal.origin || routeOrigin;
  const destination = deal.destination || routeDestination;
  if (!origin || !destination || !deal.depart || !deal.returnDate) {
    return "";
  }
  return buildGoogleFlightsUrl(origin, destination, deal.depart, deal.returnDate);
}

function buildGoogleFlightsUrl(origin, destination, depart, returnDate) {
  const tfs = encodeGoogleFlightsTfs(origin, destination, depart, returnDate);
  return `https://www.google.com/travel/flights/search?tfs=${tfs}&hl=en-US&gl=US&curr=USD`;
}

function encodeGoogleFlightsTfs(origin, destination, depart, returnDate) {
  const payload = concatBytes(
    protobufVarintField(1, 28),
    protobufVarintField(2, 2),
    protobufBytesField(3, googleFlightsSegment(origin, destination, depart)),
    protobufBytesField(3, googleFlightsSegment(destination, origin, returnDate)),
    protobufVarintField(8, 1),
    protobufVarintField(9, 1),
    protobufVarintField(14, 1),
    protobufBytesField(16, protobufVarintField(1, BigInt("18446744073709551615"))),
    protobufVarintField(19, 1),
  );
  return base64UrlEncode(payload);
}

function googleFlightsSegment(origin, destination, travelDate) {
  return concatBytes(
    protobufBytesField(2, asciiBytes(travelDate)),
    protobufBytesField(13, googleFlightsAirport(origin)),
    protobufBytesField(14, googleFlightsAirport(destination)),
  );
}

function googleFlightsAirport(code) {
  return concatBytes(
    protobufVarintField(1, 1),
    protobufBytesField(2, asciiBytes(code)),
  );
}

function protobufVarintField(fieldNumber, value) {
  return concatBytes(protobufVarint(BigInt(fieldNumber << 3)), protobufVarint(value));
}

function protobufBytesField(fieldNumber, value) {
  return concatBytes(protobufVarint(BigInt((fieldNumber << 3) | 2)), protobufVarint(value.length), value);
}

function protobufVarint(value) {
  let remaining = BigInt(value);
  const bytes = [];
  while (remaining >= 128n) {
    bytes.push(Number((remaining & 127n) | 128n));
    remaining >>= 7n;
  }
  bytes.push(Number(remaining));
  return Uint8Array.from(bytes);
}

function asciiBytes(value) {
  return Uint8Array.from(String(value).split("").map((character) => character.charCodeAt(0)));
}

function concatBytes(...chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  chunks.forEach((chunk) => {
    output.set(chunk, offset);
    offset += chunk.length;
  });
  return output;
}

function base64UrlEncode(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index];
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    output += alphabet[first >> 2];
    output += alphabet[((first & 3) << 4) | ((second ?? 0) >> 4)];
    if (index + 1 < bytes.length) {
      output += alphabet[((second & 15) << 2) | ((third ?? 0) >> 6)];
    }
    if (index + 2 < bytes.length) {
      output += alphabet[third & 63];
    }
  }
  return output;
}

function base64UrlDecode(value) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const clean = String(value || "").replace(/=/g, "");
  const bytes = [];
  for (let index = 0; index < clean.length; index += 4) {
    const first = alphabet.indexOf(clean[index]);
    const second = alphabet.indexOf(clean[index + 1]);
    const third = alphabet.indexOf(clean[index + 2]);
    const fourth = alphabet.indexOf(clean[index + 3]);
    if (first < 0 || second < 0) throw new Error("Invalid base64url payload");
    bytes.push((first << 2) | (second >> 4));
    if (third >= 0) bytes.push(((second & 15) << 4) | (third >> 2));
    if (fourth >= 0) bytes.push(((third & 3) << 6) | fourth);
  }
  return Uint8Array.from(bytes);
}

function renderMonitors() {
  monitorGrid.innerHTML = "";
  if (!state.monitors.length) {
    monitorGrid.innerHTML = `
      <section class="empty-monitor-hero" aria-label="Create your first trip">
        <div class="empty-hero-copy">
          <p class="eyebrow">Start here</p>
          <h3>Build flexible Google Flights searches without committing to exact dates.</h3>
          <p>Add one or more airport pairs, choose your travel window, then find live fares and direct Google Flights links.</p>
        </div>
        <div class="empty-steps" aria-label="How it works">
          <div><strong>1</strong><span>Add routes</span><small>Pick one or more airport pairs.</small></div>
          <div><strong>2</strong><span>Set dates</span><small>Choose start/end bounds and trip length.</small></div>
          <div><strong>3</strong><span>Find fares</span><small>Compare smart fare suggestions.</small></div>
        </div>
        <button class="primary-button empty-hero-button" type="button">Create trip</button>
      </section>
    `;
    monitorGrid.querySelector(".empty-hero-button").addEventListener("click", openCreateMonitorOverlay);
    return;
  }

  getPrioritizedMonitors().forEach((monitor) => {
    normalizeMonitor(monitor);
    const card = document.createElement("article");
    const isFindingFares = sweepState.isSweeping && sweepState.activeMonitorId === monitor.id;
    card.className = `monitor-card${isFindingFares ? " is-finding-fares" : ""}`;
    const travelWindowCount = countTravelWindows(monitor);
    card.innerHTML = `
      <header>
        <div>
          ${monitorRouteTitleHtml(monitor)}
          <div class="monitor-meta">${formatDate(monitor.startFrom)}-${formatDate(monitor.startTo)} · ${formatTripLengthSummary(monitor)} · ${formatStops(monitor.maxStops)} · ${formatAirlineFilter(monitor)}</div>
        </div>
        <div class="monitor-header-actions">
          <details class="monitor-menu">
            <summary aria-label="Trip actions"><span aria-hidden="true">⋯</span></summary>
            <div class="monitor-menu-popover">
              <button class="menu-action" type="button" data-action="edit">Edit</button>
              <button class="menu-danger" type="button" data-action="remove">Delete</button>
            </div>
          </details>
        </div>
      </header>
      <div class="metric-strip">
        <div class="metric"><span>Possible trips</span><strong>${formatInteger(travelWindowCount)}</strong></div>
        <div class="metric"><span>Latest fares</span><strong>${monitor.lastRunAt ? formatDateTime(monitor.lastRunAt) : "Not found yet"}</strong></div>
      </div>
      <section class="monitor-deals" aria-label="Top results">
        <div class="monitor-deals-heading">
          <div class="results-title">
            <h4>Top results</h4>
          </div>
          ${isFindingFares ? "<span>Finding fares</span>" : (monitor.topDeals.length ? "" : "<span>No fares yet</span>")}
        </div>
        <div class="deals-list"></div>
      </section>
    `;

    const dealsList = card.querySelector(".deals-list");
    if (monitor.topDeals.length || isFindingFares) {
      dealsList.appendChild(renderFareExplorer(monitor, monitor.topDeals, isFindingFares));
    } else {
      dealsList.innerHTML = `<p class="empty-state">Find fares to show smart Google Flights suggestions for this trip.</p>`;
    }

    card.querySelector('[data-action="edit"]').addEventListener("click", () => {
      closeOpenMonitorMenus();
      openEditMonitorOverlay(monitor.id);
    });
    card.querySelector('[data-action="remove"]').addEventListener("click", () => removeMonitor(monitor.id));
    monitorGrid.appendChild(card);
  });
}

function displayFareGroups(deals) {
  return deals
    .slice()
    .sort(compareDeals)
    .slice(0, TOP_DEAL_LIMIT);
}

function renderShareImportOverlay() {
  const existing = document.querySelector(".share-import-overlay");
  if (!pendingShareImportMonitors.length) {
    existing?.remove();
    return;
  }
  if (existing) return;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay share-import-overlay is-open";
  overlay.setAttribute("aria-hidden", "false");
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) dismissSharedImport();
  });

  const panel = document.createElement("section");
  panel.className = "builder-panel modal-panel share-import-card";
  panel.setAttribute("aria-label", "Shared trip import");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  const hasLocalMonitors = state.monitors.length > 0;
  panel.innerHTML = `
    <div class="share-import-header">
      <div>
        <p class="eyebrow">Shared dashboard</p>
        <h3>${hasLocalMonitors ? "Add shared trips?" : "Import shared trips?"}</h3>
      </div>
      <span class="status-pill">${formatTripCount(pendingShareImportMonitors.length)}</span>
    </div>
    <p class="share-import-copy">
      ${hasLocalMonitors
        ? "Choose how this shared setup should join your saved dashboard."
        : "This link includes a trip setup you can save locally."}
    </p>
    <div class="share-import-preview"></div>
    <div class="share-import-actions">
      <div class="share-choice">
        <button class="primary-button" type="button" data-share-action="combine">${hasLocalMonitors ? "Combine" : "Import"}</button>
        <p>${hasLocalMonitors ? "Keep yours and skip duplicates." : "Save these trips here."}</p>
      </div>
      ${hasLocalMonitors ? `
        <div class="share-choice">
          <button class="ghost-button" type="button" data-share-action="replace">Replace</button>
          <p>Use only the shared setup.</p>
        </div>
      ` : ""}
      <div class="share-choice">
        <button class="ghost-button" type="button" data-share-action="cancel">Keep current</button>
        <p>Dismiss this share link.</p>
      </div>
    </div>
  `;
  const preview = panel.querySelector(".share-import-preview");
  pendingShareImportMonitors.slice(0, 5).forEach((monitor) => {
    const row = document.createElement("div");
    row.className = "share-import-row";
    row.innerHTML = `
      <strong>${formatMonitorRoutes(monitor)}</strong>
      <span>${formatDate(monitor.startFrom)}-${formatDate(monitor.startTo)} · ${formatTripLengthSummary(monitor)} · ${formatStops(monitor.maxStops)} · ${formatAirlineFilter(monitor)}</span>
    `;
    preview.appendChild(row);
  });
  if (pendingShareImportMonitors.length > 5) {
    const more = document.createElement("div");
    more.className = "share-import-row share-import-more";
    more.textContent = `${formatInteger(pendingShareImportMonitors.length - 5)} more ${pendingShareImportMonitors.length - 5 === 1 ? "trip" : "trips"}`;
    preview.appendChild(more);
  }
  panel.querySelector('[data-share-action="combine"]').addEventListener("click", () => consumeSharedMonitors("combine"));
  panel.querySelector('[data-share-action="replace"]')?.addEventListener("click", () => consumeSharedMonitors("replace"));
  panel.querySelector('[data-share-action="cancel"]').addEventListener("click", dismissSharedImport);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  document.body.classList.add("modal-open");
  panel.querySelector('[data-share-action="combine"]').focus({ preventScroll: true });
}

function getPrioritizedMonitors() {
  return state.monitors.slice().sort((a, b) => {
    const bHasData = Number(Boolean(b.lastRunAt));
    const aHasData = Number(Boolean(a.lastRunAt));
    if (bHasData !== aHasData) return bHasData - aHasData;
    return new Date(b.lastRunAt || b.createdAt || 0) - new Date(a.lastRunAt || a.createdAt || 0);
  });
}

function countTravelWindows(monitor) {
  normalizeMonitor(monitor);
  return TravelWindowLogic.countPossibleTrips(monitor);
}

function removeMonitor(id) {
  const monitor = state.monitors.find((entry) => entry.id === id);
  const label = monitor ? formatMonitorRoutes(normalizeMonitor(monitor)) : "this trip";
  if (!window.confirm(`Delete ${label}? This will remove its saved fare results.`)) return;
  if (monitor?.configSignature) delete state.sweepData[monitor.configSignature];
  state.monitors = state.monitors.filter((monitor) => monitor.id !== id);
  saveState();
  render();
}

function showToast(message) {
  const existing = document.querySelector(".toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formatInteger(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value) || 0);
}

function formatDayCount(value) {
  const days = Number(value) || 0;
  return `${formatInteger(days)} ${days === 1 ? "day" : "days"}`;
}

function totalTripLength(length) {
  return Math.max(1, Math.trunc(Number(length) || 0) + 1);
}

function makeId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `monitor-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

function normalizeMonitor(monitor) {
  normalizeMonitorShape(monitor);
  monitor.id = monitor.id || makeId();
  monitor.createdAt = monitor.createdAt || new Date().toISOString();
  delete monitor.origin;
  delete monitor.destination;
  monitor.history = [];
  if (!Array.isArray(monitor.topDeals)) monitor.topDeals = [];
  monitor.topDeals = monitor.topDeals.map(normalizeDeal);
  monitor.configSignature = monitorConfigSignature(monitor);
  delete monitor.alertBelow;
  delete monitor.intervalMinutes;
  delete monitor.nextRunAt;
  return monitor;
}

function formatMonitorRoutes(monitor) {
  const pairs = monitor.pairs || [];
  if (!pairs.length) return "No airport pairs";
  if (pairs.length <= 2) {
    return pairs.map((pair) => `${pair.origin} → ${pair.destination}`).join(", ");
  }
  return `${pairs[0].origin} → ${pairs[0].destination} + ${pairs.length - 1} more`;
}

function monitorRouteTitleHtml(monitor) {
  const pairs = monitor.pairs || [];
  if (!pairs.length) return `<h3 class="route-title">No airport pairs</h3>`;
  const routeTokens = pairs.flatMap((pair, index) => [
    ...(index ? [`<span class="route-separator" aria-hidden="true"></span>`] : []),
    `<span class="route-token">
      <span>${pair.origin}</span>
      <span class="route-arrow" aria-hidden="true">→</span>
      <span>${pair.destination}</span>
    </span>`,
  ]).join("");
  return `
    <h3 class="monitor-route-title" aria-label="Airport pairs">
      ${routeTokens}
    </h3>
  `;
}

function formatPairCount(count) {
  return `${count} airport ${count === 1 ? "pair" : "pairs"}`;
}

function formatTripCount(count) {
  return `${formatInteger(count)} ${count === 1 ? "trip" : "trips"}`;
}

function formatTripLengthSummary(monitor) {
  const maxBound = TravelWindowLogic.maxTripLengthForRange(monitor.startFrom, monitor.startTo);
  if (Number(monitor.tripMin) === 0 && Number(monitor.tripMax) === maxBound) return "any length";
  if (Number(monitor.tripMin) === Number(monitor.tripMax)) return `${formatInteger(monitor.tripMin)} days`;
  return `${formatInteger(monitor.tripMin)}-${formatInteger(monitor.tripMax)} days`;
}

function formatExcludedAirlines(codes) {
  const count = Array.isArray(codes) ? codes.length : 0;
  if (!count) return "no airline exclusions";
  return `${count} airline ${count === 1 ? "excluded" : "exclusions"}`;
}

function formatAirlineFilter(monitor) {
  const count = Array.isArray(monitor.excludedAirlines) ? monitor.excludedAirlines.length : 0;
  const mode = normalizeAirlineMode(monitor.airlineMode);
  if (!count) return mode === "include" ? "any airline" : "no airline exclusions";
  if (mode === "include") return `${count} ${count === 1 ? "airline" : "airlines"} selected`;
  return count === 1 ? "1 airline excluded" : `${count} airline exclusions`;
}

function normalizeAirlineMode(value) {
  return value === "include" ? "include" : "exclude";
}

function formatStops(value) {
  const maxStops = normalizeMaxStops(value);
  if (maxStops === "ANY") return "any stops";
  if (maxStops === "0") return "nonstop";
  if (maxStops === "1") return "1 stop max";
  return "2 stops max";
}

function normalizeStopCount(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : null;
}

function formatDealStops(deal) {
  const stopCount = normalizeStopCount(deal.stopCount);
  if (stopCount !== null) {
    if (stopCount === 0) return "Nonstop";
    return `${formatInteger(stopCount)} ${stopCount === 1 ? "stop" : "stops"}`;
  }
  const maxStops = normalizeMaxStops(deal.maxStops);
  if (maxStops === "ANY") return "Any stops";
  if (maxStops === "0") return "Nonstop";
  if (maxStops === "1") return "1 stop max";
  return "2 stops max";
}

function getAirline(code) {
  return AIRLINES.find((airline) => airline.code === code) || { code, name: code };
}
