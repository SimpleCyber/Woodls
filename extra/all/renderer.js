// renderer.js
const { ipcRenderer } = require("electron");
const MicRecorder = require("mic-recorder-to-mp3");

// UI elements
const startCaptureBtn = document.getElementById("startCapture");
const clearHotkeyBtn = document.getElementById("clearHotkey");
const captureArea = document.getElementById("captureArea");
const capturedKeysSpan = document.getElementById("capturedKeys");
const saveHotkeyBtn = document.getElementById("saveHotkey");
const cancelCaptureBtn = document.getElementById("cancelCapture");
const hotkeyDisplay = document.getElementById("hotkeyDisplay");
const logs = document.getElementById("logs");
const modeSelect = document.getElementById("mode");

const ttsInput = document.getElementById("ttsInput");
const ttsSpeakBtn = document.getElementById("ttsSpeak");
const ttsStopBtn = document.getElementById("ttsStop");

const sttStatus = document.getElementById("sttStatus");
const sttResult = document.getElementById("sttResult");
const sttLang = document.getElementById("sttLang");

let capturing = false;
let captured = new Set();
let currentHotkey = [];

// microphone recorder
const recorder = new MicRecorder({ bitRate: 128 });
let isRecording = false;

// ----- Hotkey capture UI -----
function formatHotkey(keys) {
  if (!keys || keys.length === 0) return "No hotkey set";
  return keys.join(" + ");
}

startCaptureBtn.addEventListener("click", () => {
  capturing = true;
  captured.clear();
  capturedKeysSpan.textContent = "[]";
  captureArea.style.display = "block";
  startCaptureBtn.disabled = true;
  hotkeyDisplay.textContent = "Capturing keys...";
  window.focus();
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
    if (keys.length < 1) return alert("Press at least one key for combo.");
    // store unique
    const unique = Array.from(new Set(keys));
    ipcRenderer.send("save-hotkey", unique);
  }

  captureArea.style.display = "none";
  capturing = false;
  startCaptureBtn.disabled = false;
});

// capture DOM key events while in capture mode
window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  let kn = e.key || e.code || "";
  if (kn === " ") kn = "SPACE";
  captured.add(kn.toUpperCase());
  capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
  e.preventDefault();
});

// ----- IPC events for hotkey saved/loaded/cleared -----
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

// ----- Logs -----
function addLog(text, color) {
  const d = document.createElement("div");
  d.className = "log-item";
  d.style.color = color || "#222";
  d.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logs.prepend(d);
}

// ----- React to global hotkey events (sent by main) -----
// When hotkey pressed: start recording
ipcRenderer.on("hotkey-pressed", async (e, data) => {
  addLog(`Hotkey pressed: ${formatHotkey(data.keys)}`, "blue");

  // start recorder if not already
  if (!isRecording) {
    try {
      await recorder.start();
      isRecording = true;
      sttStatus.textContent = "Status: Recording...";
      sttResult.textContent = "";
      sttLang.textContent = "—";
    } catch (err) {
      console.error("Recorder start error:", err);
      addLog("Recorder start error: " + err, "red");
      sttStatus.textContent = "Status: Error starting recording";
    }
  }
});

// When hotkey released: stop recording, send to main to transcribe
ipcRenderer.on("hotkey-released", async (e, data) => {
  addLog(
    `Hotkey released: ${formatHotkey(data.keys)} — Duration ${(data.duration / 1000).toFixed(3)}s`,
    "green"
  );

  if (isRecording) {
    try {
      isRecording = false;
      sttStatus.textContent = "Status: Processing...";

      const [buffer, blob] = await recorder.stop().getMp3();

      // buffer is ArrayBuffer-like; convert to base64 for safe IPC transfer
      const nodeBuf = Buffer.from(buffer);
      const base64 = nodeBuf.toString("base64");
      const fileName = `recording_${Date.now()}.mp3`;

      // send to main process for transcription (await result)
      try {
        const result = await ipcRenderer.invoke("transcribe-audio-buffer", {
          data: base64,
          filename: fileName,
        });

        const text = result?.text ?? "";
        const language = result?.language ?? "unknown";

        sttStatus.textContent = "Status: Done";
        sttLang.textContent = language;
        sttResult.textContent = text || "(no transcription)";

        addLog(`Transcription done (lang: ${language})`, "#006400");
      } catch (transErr) {
        console.error("Transcription error:", transErr);
        sttStatus.textContent = "Status: Error";
        sttResult.textContent = String(transErr);
        addLog("Transcription error: " + String(transErr), "red");
      }
    } catch (err) {
      console.error("Stop/MP3 error:", err);
      addLog("Stop error: " + err, "red");
      sttStatus.textContent = "Status: Error stopping recorder";
    }
  }
});

// ----- Text-to-Speech -----
ttsSpeakBtn.addEventListener("click", () => {
  const text = ttsInput.value.trim();
  if (!text) return alert("Enter text to speak.");
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

// request initial hotkey
ipcRenderer.send("get-hotkey");
