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
let currentHotkey = [];

function formatHotkey(keys) {
  return keys.length ? keys.join(" + ") : "No hotkey set";
}

// ------------------ HOTKEY CAPTURE ------------------

startCaptureBtn.addEventListener("click", () => {
  capturing = true;
  captured.clear();
  capturedKeysSpan.textContent = "[]";
  captureArea.style.display = "block";
  startCaptureBtn.disabled = true;
  hotkeyDisplay.textContent = "Capturing keys...";
});

cancelCaptureBtn.addEventListener("click", () => {
  capturing = false;
  captureArea.style.display = "none";
  startCaptureBtn.disabled = false;
  hotkeyDisplay.textContent = formatHotkey(currentHotkey);
});

clearHotkeyBtn.addEventListener("click", () => {
  ipcRenderer.send("clear-hotkey");
});

saveHotkeyBtn.addEventListener("click", () => {
  const keys = Array.from(captured).map((x) => x.toUpperCase());

  if (modeSelect.value === "single") {
    if (keys.length < 1) return alert("Press a key first.");
    ipcRenderer.send("save-hotkey", [keys[keys.length - 1]]);
  } else {
    if (keys.length < 2)
      return alert("Combo mode requires at least 2 keys held together.");
    ipcRenderer.send("save-hotkey", keys);
  }

  captureArea.style.display = "none";
  capturing = false;
  startCaptureBtn.disabled = false;
});

// Capture keys in setup mode
window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  captured.add(e.key.toUpperCase());
  capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
  e.preventDefault();
});

// ------------------ IPC EVENTS ------------------

ipcRenderer.on("hotkey-saved", (e, keys) => {
  currentHotkey = keys;
  hotkeyDisplay.textContent = "Hotkey: " + formatHotkey(keys);
  addLog("Hotkey Saved: " + formatHotkey(keys));
});

ipcRenderer.on("hotkey-cleared", () => {
  currentHotkey = [];
  hotkeyDisplay.textContent = "No hotkey set";
  addLog("Hotkey Cleared");
});

ipcRenderer.on("hotkey-loaded", (e, keys) => {
  currentHotkey = keys;
  hotkeyDisplay.textContent = formatHotkey(keys);
});

ipcRenderer.on("hotkey-pressed", (e, data) => {
  addLog(`Pressed [${formatHotkey(data.keys)}]`);
});

ipcRenderer.on("hotkey-released", (e, data) => {
  addLog(
    `Released [${formatHotkey(
      data.keys
    )}] — Duration ${(data.duration / 1000).toFixed(3)}s`
  );
});

// Add log item
function addLog(text) {
  const d = document.createElement("div");
  d.className = "log-item";
  d.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logs.prepend(d);
}

// ---------------- TEXT TO SPEECH -----------------

const ttsInput = document.getElementById("ttsInput");
const ttsSpeakBtn = document.getElementById("ttsSpeak");
const ttsStopBtn = document.getElementById("ttsStop");

ttsSpeakBtn.addEventListener("click", () => {
  const text = ttsInput.value.trim();
  if (!text) return alert("Enter text first.");

  speechSynthesis.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1;
  utter.pitch = 1;
  utter.volume = 1;

  speechSynthesis.speak(utter);
});

ttsStopBtn.addEventListener("click", () => {
  speechSynthesis.cancel();
});

// Request saved hotkey
ipcRenderer.send("get-hotkey");
 