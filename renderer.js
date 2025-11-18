// renderer.js

// ---------- LLM UI ----------
const assistantName = document.getElementById("assistantName");
const appName = document.getElementById("appName");
const llmInput = document.getElementById("llmInput");
const generateBtn = document.getElementById("generateBtn");
const outputBox = document.getElementById("output");

// ---------- Active window ----------
const activeInfo = document.getElementById("activeInfo");

// ---------- Hotkey UI ----------
const startCaptureBtn = document.getElementById("startCapture");
const clearHotkeyBtn = document.getElementById("clearHotkey");
const saveHotkeyBtn = document.getElementById("saveHotkey");
const cancelCaptureBtn = document.getElementById("cancelCapture");
const captureArea = document.getElementById("captureArea");
const capturedKeysSpan = document.getElementById("capturedKeys");
const hotkeyDisplay = document.getElementById("hotkeyDisplay");
const logs = document.getElementById("logs");

// ---------- Audio player & save ----------
const player = document.getElementById("player");
const saveRecordingBtn = document.getElementById("saveRecording");

let capturing = false;      // capturing a hotkey (setup) in UI
let captured = new Set();   // captured codes while setting hotkey
let currentHotkey = [];     // loaded/saved hotkey array (display)
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let lastArrayBuffer = null;

// ---------- Normalization helper (same as main) ----------
function normalizeCode(code) {
  if (!code) return "";
  return String(code).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

// ---------------- LLM generation ----------------
// generateBtn.onclick = async () => {
//   const info = llmInput.value || "";
//   if (!info.trim()) return alert("Enter text to generate.");

//   outputBox.textContent = "Generating...";
//   try {
//     const res = await window.api.generateText({
//       info,
//       assistantName: assistantName.value || "Assistant",
//       appName: appName.value || "Desktop App",
//     });
//     outputBox.textContent = res;
//   } catch (e) {
//     outputBox.textContent = "Error: " + (e.message || String(e));
//   }
// };

// ---------------- Active window updates ----------------
window.api.onActiveWindow((_, info) => {
  if (!info) {
    activeInfo.textContent = "No active window detected";
    return;
  }
  activeInfo.innerHTML = `
    <b>Title:</b> ${info.title || "—"}<br>
    <b>App:</b> ${info.owner ? (info.owner.name || "—") : "—"}<br>
    <b>PID:</b> ${info.owner ? (info.owner.processId || "—") : "—"}
  `;
  appName.value = `${info.title} (${info.owner.name})`; 
});

// ---------------- Hotkey setup UI ----------------
startCaptureBtn.onclick = () => {
  capturing = true;
  captured.clear();
  capturedKeysSpan.textContent = "[]";
  captureArea.style.display = "block";
  addLog("Capturing hotkey: press the key you want (single key)", "gray");
  // focus the window so key events register
  window.focus();
};

cancelCaptureBtn.onclick = () => {
  capturing = false;
  captureArea.style.display = "none";
};

window.addEventListener("keydown", (e) => {
  if (!capturing) return;
  // Use e.code for consistency (e.g., "Numpad8", "KeyA", "F9")
  const code = e.code || e.key;
  const normalized = normalizeCode(code);
  captured.add(normalized);
  capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
  e.preventDefault();
});

saveHotkeyBtn.onclick = () => {
  if (captured.size === 0) {
    alert("No key captured. Press a key while capturing.");
    return;
  }
  // take the last captured value (single-key). If multiple pressed, choose last.
  const arr = Array.from(captured);
  const keyToSave = arr[arr.length - 1];
  window.api.saveHotkey([keyToSave]); // send normalized like "NUMPAD8"
  captureArea.style.display = "none";
  capturing = false;
};

// clear hotkey
clearHotkeyBtn.onclick = () => {
  window.api.clearHotkey();
};

// ---------------- Hotkey events from main ----------------
window.api.onHotkeyLoaded((_, keys) => {
  currentHotkey = keys || [];
  hotkeyDisplay.textContent = currentHotkey.length ? ("Hotkey: " + currentHotkey.join(" + ")) : "No hotkey set";
});

window.api.onHotkeySaved((_, keys) => {
  currentHotkey = keys || [];
  hotkeyDisplay.textContent = currentHotkey.length ? ("Hotkey: " + currentHotkey.join(" + ")) : "No hotkey set";
  addLog("Hotkey saved: " + currentHotkey.join(" + "), "blue");
});

window.api.onHotkeyCleared(() => {
  currentHotkey = [];
  hotkeyDisplay.textContent = "No hotkey set";
  addLog("Hotkey cleared", "red");
});

// When main signals to start recording (hotkey pressed)
window.api.onRecordStart(async () => {
  addLog("Hotkey pressed — starting recording.", "green");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(mediaStream);
    chunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
  const blob = new Blob(chunks, { type: "audio/webm" });
  const url = URL.createObjectURL(blob);
  player.src = url;

  lastArrayBuffer = await blob.arrayBuffer();
  addLog("Recording completed — sending for transcription...", "purple");

  // 🔥 AUTO SEND TO MAIN FOR TRANSCRIPTION
const text = await window.api.transcribeAudio(lastArrayBuffer);

addLog("Transcription received — generating refined output...", "green");

// Put transcribed text into the input box
llmInput.value = text;

// AUTO-GENERATE FINAL OUTPUT
document.getElementById("finalOutput").textContent = "Generating...";

const refined = await window.api.generateText({
  info: text,
  assistantName: assistantName.value || "Satyam",
  appName: appName.value || "Desktop App",
});

// Show refined output
document.getElementById("finalOutput").textContent = refined;

// AUTO TYPE AT CURSOR
await window.api.autoType(refined);
addLog("Auto-typed generated output.", "green");


addLog("Final output generated automatically.", "purple");

};


    mediaRecorder.start();
  } catch (err) {
    addLog("Failed to start recording: " + (err.message || err), "red");
  }
});

// When main signals to stop recording (hotkey released)
window.api.onRecordStop(() => {
  addLog("Hotkey released — stopping recording.", "orange");
  try {
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    } else {
      addLog("No active recording to stop.", "gray");
    }
  } catch (err) {
    addLog("Error stopping recorder: " + (err.message || err), "red");
  }
});

// Save recorded buffer to disk via main
saveRecordingBtn.onclick = async () => {
  if (!lastArrayBuffer) {
    alert("No recording to save yet.");
    return;
  }
  window.api.saveAudio(lastArrayBuffer);
};

// save-complete feedback
window.api.onSaveComplete((_, filePath) => {
  if (!filePath) {
    addLog("Save cancelled or failed.", "red");
    alert("Save cancelled or failed.");
  } else {
    addLog("Saved to: " + filePath, "green");
    alert("Saved: " + filePath);
  }
});

// hotkey pressed/released logs
window.api.onHotkeyPressed((_, data) => {
  addLog(`Hotkey pressed: ${data.key} at ${new Date(data.time).toLocaleTimeString()}`, "green");
});

window.api.onHotkeyReleased((_, data) => {
  addLog(`Hotkey released: ${data.key}. Duration: ${(data.duration/1000).toFixed(3)}s`, "blue");
});

// ---------- utility logs ----------
function addLog(text, color = "#222") {
  const d = document.createElement("div");
  d.className = "log-item";
  d.style.color = color;
  d.textContent = `${new Date().toLocaleTimeString()} — ${text}`;
  logs.prepend(d);
}

// request saved hotkey on load
window.api.getHotkey();
