// renderer.js
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

function normalize(k) {
  if (!k) return "";
  // Use the KeyboardEvent.key or code uppercase to match listener's names
  return String(k).toUpperCase();
}

function displayCaptured() {
  const arr = Array.from(captured);
  capturedKeysSpan.textContent = JSON.stringify(arr);
}

function formatHotkey(keys) {
  if (!keys || keys.length === 0) return "No hotkey set";
  return keys.join(" + ");
}

startCaptureBtn.addEventListener("click", () => {
  capturing = true;
  captured.clear();
  displayCaptured();
  captureArea.style.display = "block";
  startCaptureBtn.disabled = true;
  hotkeyDisplay.textContent = "Capturing... (press keys)";
  // focus to window to capture key events
  window.focus();
});

cancelCaptureBtn.addEventListener("click", () => {
  capturing = false;
  captureArea.style.display = "none";
  startCaptureBtn.disabled = false;
  hotkeyDisplay.textContent = formatHotkey(Array.from(currentHotkey || []));
});

clearHotkeyBtn.addEventListener("click", () => {
  ipcRenderer.send("clear-hotkey");
});

saveHotkeyBtn.addEventListener("click", () => {
  // Save captured keys
  const arr = Array.from(captured).map(normalize);
  // For single mode, ensure only one key saved (if user captured many, take last)
  if (modeSelect.value === "single") {
    if (arr.length === 0) {
      alert("No key captured for single key mode.");
      return;
    }
    ipcRenderer.send("save-hotkey", [arr[arr.length - 1]]);
  } else {
    // combo mode (strict): need at least 2 keys
    if (arr.length < 1) {
      alert("No keys captured. Press at least one key for combo.");
      return;
    }
    // store unique keys (order not important in storage), but keep user's order
    const unique = Array.from(new Set(arr));
    ipcRenderer.send("save-hotkey", unique);
  }
  capturing = false;
  captureArea.style.display = "none";
  startCaptureBtn.disabled = false;
});

let currentHotkey = [];

ipcRenderer.on("hotkey-saved", (event, keys) => {
  currentHotkey = keys;
  hotkeyDisplay.textContent = "Hotkey: " + formatHotkey(keys);
  addLog(`Hotkey saved: ${formatHotkey(keys)}`);
});

ipcRenderer.on("hotkey-cleared", () => {
  currentHotkey = [];
  hotkeyDisplay.textContent = "No hotkey set";
  addLog("Hotkey cleared");
});

ipcRenderer.on("hotkey-loaded", (event, keys) => {
  currentHotkey = keys || [];
  hotkeyDisplay.textContent = currentHotkey.length ? "Hotkey: " + formatHotkey(currentHotkey) : "No hotkey set";
});

ipcRenderer.on("hotkey-pressed", (event, data) => {
  const t = new Date(data.time).toLocaleTimeString();
  addLog(`Pressed [${formatHotkey(data.keys)}] at ${t}`, "blue");
});

ipcRenderer.on("hotkey-released", (event, data) => {
  const t = new Date(data.releaseTime).toLocaleTimeString();
  addLog(`Released [${formatHotkey(data.keys)}] at ${t} — Duration: ${(data.duration/1000).toFixed(3)}s`, "green");
});

function addLog(text, color) {
  const d = document.createElement("div");
  d.className = "log-item";
  d.style.color = color || "#222";
  d.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logs.prepend(d);
}

/* Capture key presses while in capture mode using DOM keyboard events.
   These are for capturing what user wants as hotkey. They are not the global detector.
*/
window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  // Use e.key if printable or e.code for better uniqueness. Convert to uppercase.
  let keyName = e.key;
  // Some keys like "Control", "Shift", "Alt" appear as e.key -> use that.
  if (!keyName || keyName === " ") keyName = "SPACE";
  captured.add(keyName.toUpperCase());
  displayCaptured();
  // prevent default to avoid browser shortcuts triggering while capturing
  e.preventDefault();
});

window.addEventListener("keyup", (e) => {
  if (!capturing) return;
  // For capture mode we keep keys until user saves (so they can press combination together)
  e.preventDefault();
});

// initial load: request hotkey from main
ipcRenderer.send("get-hotkey");
