const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 15000;

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
    this.socket = null;
    this.retryTimer = null;
    this.retryDelay = RETRY_MIN_MS;
    this.stopped = true;
    this.pendingPush = false;
  }

  start(code = this.code) {
    this.code = normalizeCode(code);
    this.stopped = false;

    if (!this.settings?.syncBaseUrl || !this.code) {
      this.setStatus("local");
      return;
    }

    this.connect();
    globalThis.addEventListener?.("online", () => this.connect());
    globalThis.addEventListener?.("offline", () => this.setStatus("offline"));
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  restart(code) {
    this.stop();
    this.stopped = false;
    this.retryDelay = RETRY_MIN_MS;
    this.pendingPush = false;
    this.start(code);
  }

  flush() {
    if (this.stopped) return;

    if (!this.settings?.syncBaseUrl || !this.code) {
      this.setStatus("local");
      return;
    }

    if (this.socket?.readyState === WebSocket.OPEN) {
      this.pushSnapshot();
      return;
    }

    this.pendingPush = true;
    this.httpSync().catch(() => {
      this.setStatus("offline");
      this.scheduleReconnect();
    });
  }

  connect() {
    if (
      this.stopped ||
      !this.settings?.syncBaseUrl ||
      !this.code ||
      this.socket?.readyState === WebSocket.CONNECTING ||
      this.socket?.readyState === WebSocket.OPEN
    ) {
      return;
    }

    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.setStatus("syncing");

    try {
      this.socket = new WebSocket(getWebSocketUrl(this.settings.syncBaseUrl, this.code));
    } catch {
      this.setStatus("offline");
      this.scheduleReconnect();
      return;
    }

    this.socket.addEventListener("open", () => {
      this.retryDelay = RETRY_MIN_MS;
      this.send({ type: "sync" });
    });

    this.socket.addEventListener("message", event => {
      this.handleMessage(event.data);
    });

    this.socket.addEventListener("close", () => {
      this.socket = null;
      if (this.stopped) return;
      this.setStatus("offline");
      this.scheduleReconnect();
    });

    this.socket.addEventListener("error", () => {
      this.socket?.close();
    });
  }

  handleMessage(raw) {
    let message;
    try { message = JSON.parse(raw); } catch { return; }

    if (message.type === "snapshot") {
      const serverVersion = message.version || "";
      const clientVersion = this.getVersion();

      if (!serverVersion || compareVersions(clientVersion, serverVersion) >= 0) {
        if (this.pendingPush || compareVersions(clientVersion, serverVersion) > 0) {
          this.pushSnapshot();
        } else {
          this.pendingPush = false;
          this.setStatus("synced");
        }
      } else {
        if (message.snapshot) {
          this.applyRemote(message.snapshot, serverVersion);
        }
        this.pendingPush = false;
        this.setStatus("synced");
      }
      return;
    }

    if (message.type === "ack") {
      this.pendingPush = false;
      this.setStatus("synced");
      return;
    }

    if (message.type === "error") {
      this.onError?.(message.message || null);
      this.setStatus("offline");
    }
  }

  pushSnapshot() {
    this.pendingPush = false;
    this.setStatus("syncing");
    this.send({
      type: "push",
      version: this.getVersion(),
      snapshot: this.getSnapshot()
    });
  }

  async httpSync() {
    this.setStatus("syncing");
    const response = await fetch(getSyncEndpoint(this.settings.syncBaseUrl, this.code), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        version: this.getVersion(),
        snapshot: this.getSnapshot()
      })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Sync failed");
    }

    const payload = await response.json();
    const serverVersion = payload.version || "";
    const clientVersion = this.getVersion();

    if (serverVersion && compareVersions(serverVersion, clientVersion) > 0 && payload.snapshot) {
      this.applyRemote(payload.snapshot, serverVersion);
    }

    this.pendingPush = false;
    this.setStatus("synced");
  }

  send(message) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(message));
    }
  }

  setStatus(status) {
    this.onStatus?.(status);
  }

  scheduleReconnect() {
    if (this.stopped || !this.settings?.syncBaseUrl || this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.retryDelay = Math.min(this.retryDelay * 1.6, RETRY_MAX_MS);
      this.connect();
    }, this.retryDelay);
  }
}

export async function createLinkRoom(syncBaseUrl) {
  const response = await fetch(getRoomsEndpoint(syncBaseUrl), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || "Failed to create sync room");
  }
  const data = await response.json();
  return normalizeCode(data.room?.code || "");
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

function getWebSocketUrl(syncBaseUrl, code) {
  const url = new URL(`/api/rooms/${encodeURIComponent(normalizeCode(code))}/sync`, `${syncBaseUrl.replace(/\/+$/, "")}/`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.toString();
}

function getSyncEndpoint(syncBaseUrl, code) {
  const base = syncBaseUrl.replace(/\/+$/, "");
  return `${base}/api/rooms/${encodeURIComponent(normalizeCode(code))}/sync`;
}

function getRoomsEndpoint(syncBaseUrl) {
  return `${syncBaseUrl.replace(/\/+$/, "")}/api/rooms`;
}
