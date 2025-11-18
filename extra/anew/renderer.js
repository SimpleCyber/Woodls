const { ipcRenderer } = require("electron");

const startCaptureBtn = document.getElementById("startCapture");
const clearHotkeyBtn = document.getElementById("clearHotkey");
const captureArea = document.getElementById("captureArea");
const capturedKeysSpan = document.getElementById("capturedKeys");
const saveHotkeyBtn = document.getElementById("saveHotkey");
const cancelCaptureBtn = document.getElementById("cancelCapture");
const hotkeyDisplay = document.getElementById("hotkeyDisplay");
const logs = document.getElementById("logs");
const modeSelect = document.getElementById("mode");

let capturing = false;
let captured = new Set();
let currentHotkey = [];

// Format hotkey
function formatHotkey(keys) {
  return keys.length ? keys.join(" + ") : "No hotkey set";
}

// Add log entry
function addLog(text, color) {
  const d = document.createElement("div");
  d.className = "log-item";
  d.style.color = color || "#222";
  d.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logs.prepend(d);
}

// Display captured keys
function displayCaptured() {
  capturedKeysSpan.textContent = JSON.stringify([...captured]);
}

// Start capture
startCaptureBtn.addEventListener("click", () => {
  capturing = true;
  captured.clear();
  displayCaptured();
  captureArea.style.display = "block";
  startCaptureBtn.disabled = true;
  hotkeyDisplay.textContent = "Capturing... (press keys)";
});

// Cancel capture
cancelCaptureBtn.addEventListener("click", () => {
  capturing = false;
  captureArea.style.display = "none";
  startCaptureBtn.disabled = false;
  hotkeyDisplay.textContent = formatHotkey(currentHotkey);
});

// Clear hotkey
clearHotkeyBtn.addEventListener("click", () => {
  ipcRenderer.send("clear-hotkey");
});

// Save hotkey
saveHotkeyBtn.addEventListener("click", () => {
  const arr = [...captured].map((k) => k.toUpperCase());

  if (modeSelect.value === "single") {
    if (arr.length === 0) return alert("Press a key first.");
    ipcRenderer.send("save-hotkey", [arr[arr.length - 1]]);
  } else {
    if (arr.length < 1) return alert("Capture at least one key.");
    ipcRenderer.send("save-hotkey", [...new Set(arr)]);
  }

  capturing = false;
  captureArea.style.display = "none";
  startCaptureBtn.disabled = false;
});

// IPC events
ipcRenderer.on("hotkey-saved", (e, keys) => {
  currentHotkey = keys;
  hotkeyDisplay.textContent = "Hotkey: " + formatHotkey(keys);
  addLog("Hotkey saved: " + formatHotkey(keys));
});

ipcRenderer.on("hotkey-cleared", () => {
  currentHotkey = [];
  hotkeyDisplay.textContent = "No hotkey set";
  addLog("Hotkey cleared");
});

ipcRenderer.on("hotkey-loaded", (e, keys) => {
  currentHotkey = keys || [];
  hotkeyDisplay.textContent = formatHotkey(currentHotkey);
});

// Log window + pressed hotkey
ipcRenderer.on("hotkey-pressed", (e, data) => {
  const w = data.window;
  let wtxt = "Unknown window";

  if (w && w.owner) {
    wtxt = `${w.owner.name} — ${w.title}`;
  }

  addLog(
    `Pressed [${formatHotkey(data.keys)}] | Window: ${wtxt}`,
    "blue"
  );
});

// Log duration
ipcRenderer.on("hotkey-released", (e, data) => {
  addLog(
    `Released [${formatHotkey(data.keys)}] — Duration: ${(data.duration / 1000).toFixed(3)}s`,
    "green"
  );
});

// Recording messages 🎤
ipcRenderer.on("recording-started", (event, data) => {
  addLog("🎤 Recording started → " + data.file, "purple");
});

ipcRenderer.on("recording-stopped", (event, data) => {
  addLog("🎤 Recording saved → " + data.file, "purple");
});

// Capture for hotkey setting
window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  let key = e.key.toUpperCase();
  if (key === " ") key = "SPACE";
  captured.add(key);
  displayCaptured();
  e.preventDefault();
});

// Load saved hotkey on start
ipcRenderer.send("get-hotkey");
