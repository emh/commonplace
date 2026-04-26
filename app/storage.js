import { hydrateCards } from "./model.js";

const STORAGE_KEY = "commonplace.app-state.v1";
const EMPTY_CLOCK = { wallTime: 0, counter: 0 };

function fallbackState() {
  return {
    cards: [],
    deviceId: createDeviceId(),
    clock: { ...EMPTY_CLOCK },
    sync: createSyncState()
  };
}

export function hydrateSnapshot(snapshot) {
  return {
    cards: hydrateCards(snapshot?.cards)
  };
}

export function loadAppState() {
  if (typeof window === "undefined") {
    return fallbackState();
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return fallbackState();
    }

    const parsed = JSON.parse(raw);
    return {
      ...hydrateSnapshot(parsed),
      deviceId: normalizeDeviceId(parsed.deviceId),
      clock: normalizeClock(parsed.clock),
      sync: normalizeSyncState(parsed.sync)
    };
  } catch {
    return fallbackState();
  }
}

export function saveAppState(appState) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      cards: appState.cards,
      deviceId: normalizeDeviceId(appState.deviceId),
      clock: normalizeClock(appState.clock),
      sync: normalizeSyncState(appState.sync)
    })
  );
}

export function loadSettings() {
  return {
    syncBaseUrl: getConfiguredSyncBaseUrl() || getDefaultSyncBaseUrl(),
    studyBaseUrl: getConfiguredStudyBaseUrl() || getDefaultStudyBaseUrl(),
    articleBaseUrl: getConfiguredArticleBaseUrl() || getDefaultArticleBaseUrl()
  };
}

function createDeviceId() {
  return `commonplace-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
}

function normalizeDeviceId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : createDeviceId();
}

function normalizeClock(clock) {
  return {
    wallTime: Number.isFinite(clock?.wallTime) ? Number(clock.wallTime) : 0,
    counter: Number.isFinite(clock?.counter) ? Number(clock.counter) : 0
  };
}

function createSyncState(input = {}) {
  return {
    code: normalizeCode(input.code),
    stateVersion: typeof input.stateVersion === "string" ? input.stateVersion : ""
  };
}

function normalizeSyncState(input = {}) {
  return createSyncState(input);
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function getConfiguredStudyBaseUrl() {
  const value = globalThis.COMMONPLACE_CONFIG?.studyBaseUrl;
  if (typeof value !== "string") return "";
  if (value.includes("YOUR_")) return "";
  return value.trim().replace(/\/+$/, "");
}

function getDefaultStudyBaseUrl() {
  const host = globalThis.location?.hostname || "";
  const protocol = globalThis.location?.protocol || "";

  if (protocol === "file:") return "";
  if (host === "localhost") return "http://localhost:8034";
  if (host === "127.0.0.1") return "http://127.0.0.1:8034";
  if (isPrivateNetworkHost(host)) return `${protocol || "http:"}//${host}:8034`;
  return "";
}

function getConfiguredSyncBaseUrl() {
  const value = globalThis.COMMONPLACE_CONFIG?.syncBaseUrl;
  if (typeof value !== "string") return "";
  if (value.includes("YOUR_")) return "";
  return value.trim().replace(/\/+$/, "");
}

function getDefaultSyncBaseUrl() {
  const host = globalThis.location?.hostname || "";
  const protocol = globalThis.location?.protocol || "";

  if (protocol === "file:") {
    return "";
  }

  if (host === "localhost") {
    return "http://localhost:8798";
  }

  if (host === "127.0.0.1") {
    return "http://127.0.0.1:8798";
  }

  if (isPrivateNetworkHost(host)) {
    return `${protocol || "http:"}//${host}:8798`;
  }

  return "";
}

function getConfiguredArticleBaseUrl() {
  const value = globalThis.COMMONPLACE_CONFIG?.articleBaseUrl;
  if (typeof value !== "string") return "";
  if (value.includes("YOUR_")) return "";
  return value.trim().replace(/\/+$/, "");
}

function getDefaultArticleBaseUrl() {
  const host = globalThis.location?.hostname || "";
  const protocol = globalThis.location?.protocol || "";

  if (protocol === "file:") return "";
  if (host === "localhost") return "http://localhost:8799";
  if (host === "127.0.0.1") return "http://127.0.0.1:8799";
  if (isPrivateNetworkHost(host)) return `${protocol || "http:"}//${host}:8799`;
  return "";
}

function isPrivateNetworkHost(host) {
  if (!host) return false;
  if (host.endsWith(".local")) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
}
