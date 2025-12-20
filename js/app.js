// js/app.js
import { addLog, $ } from './utils.js';
import * as Notes from './notes.js';

// ---------- LLM UI / Settings References ----------
const assistantName = document.getElementById("assistantName");
const appName = document.getElementById("appName");
const activeInfo = document.getElementById("activeInfo");

// ---------- Hotkey UI ----------
const startCaptureBtn = document.getElementById("startCapture");
const clearHotkeyBtn = document.getElementById("clearHotkey");
const saveHotkeyBtn = document.getElementById("saveHotkey");
const cancelCaptureBtn = document.getElementById("cancelCapture");
const captureArea = document.getElementById("captureArea");
const capturedKeysSpan = document.getElementById("capturedKeys");
const hotkeyDisplay = document.getElementById("hotkeyDisplay");

// ---------- Audio / History ----------
const historyList = document.getElementById("history-list");
const historyTabBtn = document.querySelector('[data-page="history"]');

// ---------- Window Controls ----------
const minBtn = document.getElementById("min-btn");
const maxBtn = document.getElementById("max-btn");
const closeBtn = document.getElementById("close-btn");

if (minBtn) minBtn.onclick = () => window.api.minimizeWindow();
if (maxBtn) maxBtn.onclick = () => window.api.maximizeWindow();
if (closeBtn) closeBtn.onclick = () => window.api.closeWindow();

// ---------- Global State ----------
let capturing = false;
let captured = new Set();
let currentHotkey = [];
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

// ---------- Initialization ----------

export function initApp() {
    setupSettings();
    setupHotkeyUI();
    setupRecordingEvents();
    setupHistory();
    
    // Init other modules
    Notes.initNotes();
    
    // Tab Switching
    document.querySelectorAll('.sidebar-item').forEach(item => {
        item.onclick = () => {
          document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
          document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
  
          item.classList.add('active');
          const page = item.dataset.page;
          const pEl = document.getElementById(page);
          if (pEl) pEl.classList.remove('hidden');
        };
      });

    // Initial Fetch
    window.api.getHotkey();
}

function setupSettings() {
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

    // Active Window
    window.api.onActiveWindow((_, info) => {
      if (!info) {
        if (activeInfo) activeInfo.textContent = "No active window detected";
        return;
      }
      if (activeInfo) {
          activeInfo.innerHTML = `
            <b>Title:</b> ${info.title || "—"}<br>
            <b>App:</b> ${info.owner ? (info.owner.name || "—") : "—"}<br>
            <b>PID:</b> ${info.owner ? (info.owner.processId || "—") : "—"}
          `;
      }
      if (appName) appName.value = `${info.title} (${info.owner.name})`; 
    });
}

function setupHotkeyUI() {
    if (startCaptureBtn) {
        startCaptureBtn.onclick = () => {
          capturing = true;
          captured.clear();
          capturedKeysSpan.textContent = "[]";
          captureArea.classList.remove("hidden");
          captureArea.style.display = "flex";
          addLog("Capturing hotkey...", "gray");
          window.focus();
        };
    }
    
    if (cancelCaptureBtn) {
        cancelCaptureBtn.onclick = () => {
          capturing = false;
          captureArea.classList.add("hidden");
          captureArea.style.display = ""; 
        };
    }
    
    if (saveHotkeyBtn) {
        saveHotkeyBtn.onclick = () => {
            if (captured.size === 0) return alert("No key captured.");
            const arr = Array.from(captured);
            const keyToSave = arr[arr.length - 1];
            window.api.saveHotkey([keyToSave]);
            captureArea.classList.add("hidden");
            captureArea.style.display = "";
            capturing = false;
        };
    }
    
    if (clearHotkeyBtn) {
        clearHotkeyBtn.onclick = () => window.api.clearHotkey();
    }
    
    // Keyboard Capture
    window.addEventListener("keydown", (e) => {
      if (!capturing) return;
      const code = e.code || e.key;
      captured.add(code);
      if (capturedKeysSpan) capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
      e.preventDefault();
    });

    // Hotkey IPC Events
    window.api.onHotkeyLoaded((_, keys) => {
        currentHotkey = keys || [];
        updateHotkeyDisplay(currentHotkey);
    });
    window.api.onHotkeySaved((_, keys) => {
        currentHotkey = keys || [];
        updateHotkeyDisplay(currentHotkey);
        addLog("Hotkey saved", "blue");
    });
    window.api.onHotkeyCleared(() => {
        currentHotkey = [];
        updateHotkeyDisplay([]);
        addLog("Hotkey cleared", "red");
    });
}

function updateHotkeyDisplay(keys) {
    const targets = document.querySelectorAll('.hotkey-dynamic-text');
    targets.forEach(el => {
        if (keys && keys.length > 0) {
            el.textContent = keys[0];
            el.classList.remove("text-slate-400", "italic");
            el.classList.add("text-slate-800", "font-bold");
        } else {
            el.textContent = "Set Hotkey";
            el.classList.remove("text-slate-800", "font-bold");
            el.classList.add("text-slate-400", "italic");
        }
    });
    if (hotkeyDisplay) {
        hotkeyDisplay.textContent = keys.length ? ("Hotkey: " + keys.join(" + ")) : "No hotkey set";
    }
}

function setupRecordingEvents() {
    window.api.onRecordStart(async () => {
        addLog("Recording started", "green");
        window.api.showOverlay();
      
        try {
          mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          mediaRecorder = new MediaRecorder(mediaStream);
          chunks = [];
      
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };
      
          mediaRecorder.onstop = async () => {
            window.api.processingStart();
            
            const blob = new Blob(chunks, { type: "audio/webm" });
            lastArrayBuffer = await blob.arrayBuffer();
            
            addLog("Transcribing...", "purple");
            const text = await window.api.transcribeAudio(lastArrayBuffer);
            addLog("Generating refined text...", "green");
      
            const refined = await window.api.generateText({
              info: text,
              assistantName: assistantName ? assistantName.value : "Assistant",
              appName: appName ? appName.value : "Desktop App",
            });
      
            // Check if Notes is active
            const isNotesActive = document.querySelector('[data-page="notes"].active');
            
            if (isNotesActive) {
                // Delegate to Notes module
                Notes.handleVoiceInput(refined);
            } else {
                // Default: Auto-type
                 if (useBackspace) {
                    await window.api.sendBackspace(); 
                    await new Promise(r => setTimeout(r, 50));
                }
                if (instantPaste) {
                    await window.api.pasteString(refined);
                    addLog("Pasted", "green");
                } else {
                    await window.api.autoType(refined);
                    addLog("Auto-typed", "green");
                }
            }
      
            window.api.processingEnd(); 
            setTimeout(() => window.api.hideOverlay(), 1000); 
          };
      
          mediaRecorder.start();
        } catch (err) {
          addLog("Rec Start Error: " + err, "red");
          window.api.hideOverlay();
        }
      });
      
      window.api.onRecordStop(() => {
        addLog("Recording stopped", "orange");
        try {
          if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
          }
        } catch (err) { console.error(err); }
      });
}

function setupHistory() {
    if (historyTabBtn) {
        historyTabBtn.addEventListener("click", loadHistory);
    }
}

async function loadHistory() {
    if (!historyList) return;
    historyList.innerHTML = '<div class="text-center text-slate-400 py-10">Loading...</div>';
    try {
        const history = await window.api.getHistory();
        renderHistory(history);
    } catch (e) {
        historyList.innerHTML = '<div class="text-center text-red-400 py-10">Error</div>';
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
            <div class="flex justify-between items-start mb-2">
                <div class="text-[10px] uppercase font-bold text-slate-400">${new Date(item.timestamp).toLocaleString()}</div>
                <button class="del-btn text-slate-400 hover:text-red-500"><i class="fa-solid fa-trash"></i></button>
            </div>
            <div class="bg-white border border-slate-100 rounded-xl p-4 shadow-sm text-sm text-slate-700">
                ${item.text || "No text"}
            </div>
        `;
        const delBtn = div.querySelector(".del-btn");
        if (delBtn) {
            delBtn.onclick = async () => {
                if (confirm("Delete?")) {
                    await window.api.deleteHistoryItem(item.id);
                    loadHistory();
                }
            };
        }
        historyList.appendChild(div);
    });
}
