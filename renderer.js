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
const homeHotkeyText = document.getElementById("home-hotkey-text");
const visualizerBar = document.getElementById("visualizer-bar");
const micStatus = document.getElementById("micStatus");

// History
const historyList = document.getElementById("history-list");
const historyTabBtn = document.querySelector('[data-page="history"]');

if (historyTabBtn) {
    historyTabBtn.addEventListener("click", loadHistory);
}

async function loadHistory() {
    if (!historyList) return;
    historyList.innerHTML = '<div class="text-center text-slate-400 py-10">Loading...</div>';
    
    try {
        const history = await window.api.getHistory();
        renderHistory(history);
    } catch (e) {
        historyList.innerHTML = '<div class="text-center text-red-400 py-10">Failed to load history</div>';
    }
}

function renderHistory(items) {
    if (!items || items.length === 0) {
        historyList.innerHTML = '<div class="text-center text-slate-400 py-10">No history yet.</div>';
        return;
    }

    historyList.innerHTML = "";
    items.forEach(item => {
        const div = document.createElement("div");
        div.className = "relative pl-6 border-l-2 border-slate-100 pb-8 last:pb-0";
        div.innerHTML = `
            <span class="absolute -left-[5px] top-1 w-2.5 h-2.5 bg-slate-200 rounded-full border-2 border-white"></span>
            <div class="flex justify-between items-start mb-2">
                <div class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">${new Date(item.timestamp).toLocaleString()}</div>
                <div class="flex gap-2 opacity-50 hover:opacity-100 transition-opacity">
                    ${item.audioPath ? `<button class="play-btn w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-primary-50 text-slate-500 hover:text-primary-600 transition-colors" title="Play Recording"><i class="fa-solid fa-play text-[10px]"></i></button>` : ''}
                     <button class="copy-btn w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 transition-colors" title="Copy Text"><i class="fa-regular fa-copy text-[10px]"></i></button>
                    <button class="del-btn w-6 h-6 flex items-center justify-center rounded bg-slate-100 hover:bg-red-50 text-slate-500 hover:text-red-600 transition-colors" title="Delete"><i class="fa-solid fa-trash text-[10px]"></i></button>
                </div>
            </div>
            <div class="bg-white border border-slate-100 rounded-xl p-4 shadow-sm text-sm text-slate-700 leading-relaxed font-medium">
                ${item.text || "<span class='text-slate-300 italic'>No text content</span>"}
            </div>
        `;
        
        // Bind events
        const playBtn = div.querySelector(".play-btn");
        if (playBtn) {
            playBtn.onclick = async () => {
                // If this is currently playing, pause it
                if (currentAudio && currentAudio.src === "data:audio/webm;base64," + (await window.api.readAudioFile(item.audioPath))) {
                     if (!currentAudio.paused) {
                         currentAudio.pause();
                         playBtn.innerHTML = '<i class="fa-solid fa-play text-[10px]"></i>';
                         return;
                     }
                }

                // Stop any other audio
                if (currentAudio) {
                   currentAudio.pause();
                   currentAudio = null;
                   // Reset all icons (brute force or track prev button)
                   document.querySelectorAll('.play-btn i').forEach(i => i.className = "fa-solid fa-play text-[10px]");
                }

                const b64 = await window.api.readAudioFile(item.audioPath);
                if (b64) {
                    const sound = new Audio("data:audio/webm;base64," + b64);
                    currentAudio = sound;
                    
                    sound.play();
                    playBtn.innerHTML = '<i class="fa-solid fa-pause text-[10px]"></i>';
                    
                    sound.onended = () => {
                        playBtn.innerHTML = '<i class="fa-solid fa-play text-[10px]"></i>';
                        currentAudio = null;
                    };
                } else {
                    alert("Audio file not found.");
                }
            };
        }

        const copyBtn = div.querySelector(".copy-btn");
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(item.text);
                const originalIcon = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fa-solid fa-check text-[10px]"></i>';
                setTimeout(() => copyBtn.innerHTML = originalIcon, 1500);
            };
        }
        
        const delBtn = div.querySelector(".del-btn");
        if (delBtn) {
            delBtn.onclick = async () => {
                if (confirm("Delete this item?")) {
                    await window.api.deleteHistoryItem(item.id);
                    loadHistory();
                }
            };
        }

        historyList.appendChild(div);
    });
}

function updateHomeHotkeyDisplay(keys) {
    if (!homeHotkeyText) return;
    if (keys && keys.length > 0) {
        homeHotkeyText.textContent = keys[0]; // e.g. "NUMPAD0"
        homeHotkeyText.classList.remove("text-slate-400", "italic");
        homeHotkeyText.classList.add("text-slate-800", "font-bold");
    } else {
        homeHotkeyText.textContent = "Set the key";
        homeHotkeyText.classList.remove("text-slate-800", "font-bold");
        homeHotkeyText.classList.add("text-slate-400", "italic"); // Styling for "Set the key"
    }
}
let captured = new Set();   // captured codes while setting hotkey
let currentHotkey = [];     // loaded/saved hotkey array (display)
let currentAudio = null;
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let lastArrayBuffer = null;

// Settings
let useBackspace = true;
let instantPaste = false;
let aiEnhanced = true;

const backspaceToggle = document.getElementById("backspaceToggle");
const pasteToggle = document.getElementById("pasteToggle");
const aiToggle = document.getElementById("aiToggle");

// Load settings
window.api.onSettingsLoaded((_ , settings) => {
    if (settings) {
       if (typeof settings.useBackspace === 'boolean') useBackspace = settings.useBackspace;
       if (typeof settings.instantPaste === 'boolean') instantPaste = settings.instantPaste;
       if (typeof settings.aiEnhanced === 'boolean') aiEnhanced = settings.aiEnhanced;
       
       if (backspaceToggle) backspaceToggle.checked = useBackspace;
       if (pasteToggle) pasteToggle.checked = instantPaste;
       if (aiToggle) aiToggle.checked = aiEnhanced;
    }
});

if (backspaceToggle) {
    backspaceToggle.onchange = () => {
        useBackspace = backspaceToggle.checked;
        window.api.saveSetting('useBackspace', useBackspace);
    };
}
if (pasteToggle) {
    pasteToggle.onchange = () => {
        instantPaste = pasteToggle.checked;
        window.api.saveSetting('instantPaste', instantPaste);
    };
}
if (aiToggle) {
    aiToggle.onchange = () => {
        aiEnhanced = aiToggle.checked;
        window.api.saveSetting('aiEnhanced', aiEnhanced);
    };
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

// ---------------- Audio Analysis (Visualizer) ----------------
let audioContext = null;
let analyser = null;
let dataArray = null;
let volumeInterval = null;

function startAudioAnalysis(stream) {
  if (!audioContext) audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  analyser = audioContext.createAnalyser();
  analyser.fftSize = 64; // Low resolution for simple volume
  source.connect(analyser);
  
  const bufferLength = analyser.frequencyBinCount;
  dataArray = new Uint8Array(bufferLength);

  // Send volume to main process every 50ms
  volumeInterval = setInterval(() => {
    if (!analyser) return;
    analyser.getByteFrequencyData(dataArray);
    
    // Calculate average volume
    let sum = 0;
    for(let i = 0; i < bufferLength; i++) {
        sum += dataArray[i];
    }
    let average = sum / bufferLength; // 0-255
    let normalized = average / 255;   // 0.0-1.0
    
    // Send to overlay
    window.api.sendMicVolume(normalized);
    
    // Update local visualizer
    if (visualizerBar) {
        visualizerBar.style.width = (normalized * 100) + "%";
    }
  }, 50);
}

function stopAudioAnalysis() {
  if (volumeInterval) clearInterval(volumeInterval);
  if (analyser) analyser.disconnect();
  // Don't close AudioContext, reuse it
  volumeInterval = null;
  analyser = null;
}

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
  
  // Ensure it's visible and flex
  captureArea.classList.remove("hidden");
  captureArea.style.display = "flex"; // Force flex for centering
  
  addLog("Capturing hotkey: press the key you want (single key)", "gray");
  // focus the window so key events register
  window.focus();
};

cancelCaptureBtn.onclick = () => {
  capturing = false;
  captureArea.classList.add("hidden");
  captureArea.style.display = ""; // Reset
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
  
  captureArea.classList.add("hidden");
  captureArea.style.display = "";
  capturing = false;
};

// clear hotkey
clearHotkeyBtn.onclick = () => {
  window.api.clearHotkey();
};

// ---------------- Hotkey events from main ----------------
window.api.onHotkeyLoaded((_, keys) => {
  currentHotkey = keys || [];
  updateHomeHotkeyDisplay(currentHotkey);
  hotkeyDisplay.textContent = currentHotkey.length ? ("Hotkey: " + currentHotkey.join(" + ")) : "No hotkey set";
});

window.api.onHotkeySaved((_, keys) => {
  currentHotkey = keys || [];
  updateHomeHotkeyDisplay(currentHotkey);
  hotkeyDisplay.textContent = currentHotkey.length ? currentHotkey.join(" + ") : "Set Hotkey";
  addLog("Hotkey saved: " + currentHotkey.join(" + "), "blue");
});

window.api.onHotkeyCleared(() => {
  currentHotkey = [];
  updateHomeHotkeyDisplay([]);
  hotkeyDisplay.textContent = "Set Hotkey";
  addLog("Hotkey cleared", "red");
});

// When main signals to start recording (hotkey pressed)
window.api.onRecordStart(async () => {
  addLog("Hotkey pressed — starting recording.", "green");
  
  // Show Overlay
  window.api.showOverlay();
  
  if (micStatus) {
      micStatus.innerHTML = `<div class="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div><span class="text-emerald-600">Mic Active</span>`;
      micStatus.className = "flex items-center gap-2 px-4 py-2 bg-emerald-50/50 text-slate-600 rounded-full text-xs font-semibold border border-emerald-200 transition-all";
  }

  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    // Start Analysis
    startAudioAnalysis(mediaStream);
    
    mediaRecorder = new MediaRecorder(mediaStream);
    chunks = [];

    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      // ------------------------------------
      // START PROCESSING - Show spinner and KEEP OVERLAY
      window.api.processingStart();
      // ------------------------------------
      
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

      // AUTO TYPE / PASTE
      if (useBackspace) {
          await window.api.sendBackspace(); // Remove the hotkey char
          await new Promise(r => setTimeout(r, 50));
      }

      if (instantPaste) {
          await window.api.pasteString(refined);
          addLog("Pasted generated output.", "green");
      } else {
          await window.api.autoType(refined);
          addLog("Auto-typed generated output.", "green");
      }

      addLog("Final output generated.", "purple");
      
      // ------------------------------------
      // END PROCESSING - Hide overlay now
      window.api.processingEnd(); // Stop spinner
      setTimeout(() => window.api.hideOverlay(), 1000); 
      // ------------------------------------
    };

    mediaRecorder.start();
  } catch (err) {
    addLog("Failed to start recording: " + (err.message || err), "red");
    window.api.hideOverlay(); // Hide if failed
  }
});

// When main signals to stop recording (hotkey released)
window.api.onRecordStop(() => {
  addLog("Hotkey released — stopping recording.", "orange");
  
  // Hide Overlay -> REMOVED to keep it visible during processing
  // window.api.hideOverlay();
  
  stopAudioAnalysis();
  
  if (micStatus) {
       micStatus.innerHTML = `<div class="w-2 h-2 rounded-full bg-slate-400"></div><span>Mic Inactive</span>`;
       micStatus.className = "flex items-center gap-2 px-4 py-2 bg-slate-50 text-slate-500 rounded-full text-xs font-semibold border border-slate-200 transition-all";
  }
  if (visualizerBar) visualizerBar.style.width = "0%";
  
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

// ---------- Window Controls ----------
const minBtn = document.getElementById("min-btn");
const maxBtn = document.getElementById("max-btn");
const closeBtn = document.getElementById("close-btn");

if (minBtn) minBtn.onclick = () => window.api.minimizeWindow();
if (maxBtn) maxBtn.onclick = () => window.api.maximizeWindow();
if (closeBtn) closeBtn.onclick = () => window.api.closeWindow();
