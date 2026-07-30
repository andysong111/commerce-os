const STORAGE_KEY = "commerce-os-product-launch-tracker:v2";
const STATE_API = "/api/product-launch-tracker/state";
const nativeSetItem = Storage.prototype.setItem;
let applyingRemoteState = false;
let saveTimer = null;
let serverStorageAvailable = true;

Storage.prototype.setItem = function patchedSetItem(key, value) {
  nativeSetItem.call(this, key, value);
  if (
    this === localStorage &&
    key === STORAGE_KEY &&
    !applyingRemoteState
  ) {
    queueServerSave(value);
  }
};

const localState = readStoredState();
const remote = await readServerState();
let shouldUploadLocalAfterBoot = false;

if (remote?.state && shouldUseRemoteState(remote, localState)) {
  applyingRemoteState = true;
  try {
    nativeSetItem.call(localStorage, STORAGE_KEY, JSON.stringify(remote.state));
  } finally {
    applyingRemoteState = false;
  }
} else if (localState && remote) {
  shouldUploadLocalAfterBoot = true;
}

await import("./main-app.js");
await import("./shopling-upload-ui.js");

if (shouldUploadLocalAfterBoot) {
  const latestLocalState = localStorage.getItem(STORAGE_KEY);
  if (latestLocalState) queueServerSave(latestLocalState, 0);
} else if (remote?.state) {
  setSaveStatus("서버 저장본 불러옴");
} else if (!serverStorageAvailable) {
  setSaveStatus("브라우저 저장 사용 중");
}

function readStoredState() {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    const parsed = value ? JSON.parse(value) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

async function readServerState() {
  try {
    const response = await fetch(STATE_API, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      serverStorageAvailable = false;
      console.warn("Product launch tracker server state is unavailable.", body);
      return null;
    }
    return body;
  } catch (error) {
    serverStorageAvailable = false;
    console.warn("Product launch tracker server state request failed.", error);
    return null;
  }
}

function shouldUseRemoteState(remote, local) {
  if (!remote?.state) return false;
  if (!local) return true;
  const remoteTime = timestampOf(remote.updatedAt ?? remote.state.savedAt);
  const localTime = timestampOf(local.savedAt);
  return remoteTime >= localTime;
}

function timestampOf(value) {
  const timestamp = Date.parse(String(value ?? ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function queueServerSave(serialized, delay = 500) {
  if (!serverStorageAvailable) return;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveServerState(serialized);
  }, delay);
}

async function saveServerState(serialized) {
  let state;
  try {
    state = JSON.parse(serialized);
  } catch {
    return;
  }
  setSaveStatus("서버 저장 중");
  try {
    const response = await fetch(STATE_API, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ state }),
      credentials: "same-origin",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.ok !== true) {
      serverStorageAvailable = false;
      console.warn("Product launch tracker server save failed.", body);
      setSaveStatus("브라우저에만 저장됨");
      return;
    }
    setSaveStatus("서버에 저장됨");
  } catch (error) {
    serverStorageAvailable = false;
    console.warn("Product launch tracker server save request failed.", error);
    setSaveStatus("브라우저에만 저장됨");
  }
}

function setSaveStatus(message) {
  const element = document.querySelector("#save-status");
  if (element) element.textContent = message;
}
