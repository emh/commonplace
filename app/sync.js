export class CommonplaceSync {
  constructor({ settings, deviceId, code, getVersion, getSnapshot, applyRemote, onStatus, onError }) {
    this.settings = settings;
    this.deviceId = deviceId;
    this.code = normalizeCode(code);
    this.getVersion = getVersion;
    this.getSnapshot = getSnapshot;
    this.applyRemote = applyRemote;
    this.onStatus = onStatus;
    this.onError = onError;
    this.stopped = true;
  }

  start(code = this.code) {
    this.code = normalizeCode(code);
    this.stopped = false;

    if (!this.settings?.syncBaseUrl || !this.code) {
      this.setStatus("local");
      return;
    }

    this.setStatus("ready");
  }

  stop() {
    this.stopped = true;
  }

  flush() {
    if (this.stopped) {
      return;
    }

    this.setStatus(this.code ? "ready" : "local");
  }

  setStatus(status) {
    this.onStatus?.(status);
  }
}

export async function createLinkRoom() {
  throw new Error("Sync worker is not implemented yet.");
}

export async function fetchLinkState() {
  throw new Error("Sync worker is not implemented yet.");
}

export function buildDeviceLink(locationHref, code) {
  const url = new URL(locationHref);
  url.searchParams.set("link", normalizeCode(code));
  return url.toString();
}

export function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);

  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.deviceId.localeCompare(b.deviceId);
}

export function nextClock(clock, deviceId) {
  const current = normalizeClock(clock);
  const now = Date.now();

  if (now > current.wallTime) {
    const next = { wallTime: now, counter: 0 };
    return { clock: next, version: formatVersion(next, deviceId) };
  }

  const next = { wallTime: current.wallTime, counter: current.counter + 1 };
  return { clock: next, version: formatVersion(next, deviceId) };
}

export function observeClock(clock, version) {
  const current = normalizeClock(clock);
  const incoming = parseVersion(version);

  if (incoming.wallTime > current.wallTime) {
    return { wallTime: incoming.wallTime, counter: incoming.counter };
  }

  if (incoming.wallTime === current.wallTime && incoming.counter > current.counter) {
    return { wallTime: incoming.wallTime, counter: incoming.counter };
  }

  return current;
}

function formatVersion(clock, deviceId) {
  return `${String(clock.wallTime).padStart(13, "0")}:${String(clock.counter).padStart(4, "0")}:${deviceId}`;
}

function parseVersion(value) {
  const [wallTime = "0", counter = "0", deviceId = ""] = String(value || "").split(":");
  return {
    wallTime: Number(wallTime) || 0,
    counter: Number(counter) || 0,
    deviceId: String(deviceId || "")
  };
}

function normalizeClock(clock) {
  return {
    wallTime: Number.isFinite(clock?.wallTime) ? Number(clock.wallTime) : 0,
    counter: Number.isFinite(clock?.counter) ? Number(clock.counter) : 0
  };
}
