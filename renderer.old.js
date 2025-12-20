// renderer.js

// ---------- LLM UI / Settings References ----------
const assistantName = document.getElementById("assistantName");
const appName = document.getElementById("appName");
// Old elements removed: llmInput, generateBtn, outputBox, micStatus, visualizerBar 
// We define them as null-safe or just query dynamically if needed.
const activeInfo = document.getElementById("activeInfo");
const logs = document.getElementById("logs");

// ---------- Hotkey UI ----------
const startCaptureBtn = document.getElementById("startCapture");
const clearHotkeyBtn = document.getElementById("clearHotkey");
const saveHotkeyBtn = document.getElementById("saveHotkey");
const cancelCaptureBtn = document.getElementById("cancelCapture");
const captureArea = document.getElementById("captureArea");
const capturedKeysSpan = document.getElementById("capturedKeys");
const hotkeyDisplay = document.getElementById("hotkeyDisplay");

// ---------- Audio / History ----------
const player = document.getElementById("player"); // Might be null now
const historyList = document.getElementById("history-list");
const historyTabBtn = document.querySelector('[data-page="history"]');

// ---------- Window Controls ----------
const minBtn = document.getElementById("min-btn");
const maxBtn = document.getElementById("max-btn");
const closeBtn = document.getElementById("close-btn");

if (minBtn) minBtn.onclick = () => window.api.minimizeWindow();
if (maxBtn) maxBtn.onclick = () => window.api.maximizeWindow();
if (closeBtn) closeBtn.onclick = () => window.api.closeWindow();

// ---------- Notes UI ----------
const notesTabBtn = document.querySelector('[data-page="notes"]');
const notesGrid = document.getElementById("notes-grid");
const notesEmptyState = document.getElementById("notes-empty-state");
const refreshNotesBtn = document.getElementById("refreshNotes");
const noteSearch = document.getElementById("note-search");
const takeNoteWrapper = document.getElementById("take-note-wrapper");
const noteTitleContainer = document.getElementById("note-title-container");
const noteTitleInput = document.getElementById("note-title-input");
const noteContentInput = document.getElementById("note-content-input");
const noteFooterContainer = document.getElementById("note-footer-container");
const closeNoteBtn = document.getElementById("close-note-btn");
const voiceNoteBtn = document.getElementById("voice-note-btn");

// ---------- Global State ----------
let capturing = false;
let captured = new Set();
let allNotes = [];
let currentHotkey = [];
let mediaRecorder = null;
let mediaStream = null;
let chunks = [];
let lastArrayBuffer = null;
let isNoteExpanded = false;

// Settings
let useBackspace = true;
let instantPaste = false;
let aiEnhanced = true;

const backspaceToggle = document.getElementById("backspaceToggle");
const pasteToggle = document.getElementById("pasteToggle");
const aiToggle = document.getElementById("aiToggle");

// ---------- Initialization ----------

// Load Settings
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

// Settings Events
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

// Hotkey UI Events
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
  const normalized = normalizeCode(code); // Helper needed? Or just pass code? 
  // Wait, I define normalizeCode locally or use IPC?
  // Previous code had normalizeCode usage but I don't see definition in step 70?
  // Ah, looking at step 70, Line 310 calls `normalizeCode(code)`. 
  // BUT I don't see `function normalizeCode` defined in Step 70 code!
  // THIS WAS THE CRASH! "normalizeCode is not defined" when pressing key?
  // No, user said app crashed on start.
  // I will define it.
  captured.add(normalized);
  if (capturedKeysSpan) capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
  e.preventDefault();
});

function normalizeCode(code) {
    return code; // Simplified, main process handles normalization mostly
}

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

// ---------- RECORDING LOGIC ----------

window.api.onRecordStart(async () => {
  addLog("Recording started", "green");
  window.api.showOverlay();

  // Mic visualization (dynamic check)
  // We removed #micStatus, so skip updating it unless strict requirement.
  
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // Audio Context Visualizer (Skip for now to reduce complexity/errors)
    
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

      // Target Logic
      const isNotesActive = document.querySelector('[data-page="notes"].active');
      
      if (isNotesActive && noteContentInput) {
          if (noteContentInput.value) {
              noteContentInput.value += "\n" + refined;
          } else {
              noteContentInput.value = refined;
          }
          expandNoteInput();
          addLog("Added to Note", "green");
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

// ---------- HISTORY ----------
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

// ---------- NOTES ----------
let isExp = false;
function expandNoteInput() {
    if (isExp) return;
    isExp = true;
    if (noteTitleContainer) noteTitleContainer.classList.remove("hidden");
    if (noteFooterContainer) noteFooterContainer.classList.remove("hidden");
    if (takeNoteWrapper) takeNoteWrapper.classList.add("shadow-md");
}
function collapseNoteInput() {
    const t = noteTitleInput ? noteTitleInput.value.trim() : "";
    const c = noteContentInput ? noteContentInput.value.trim() : "";
    if (t || c) saveNoteAndClear(t, c);
    
    isExp = false;
    if (noteTitleContainer) noteTitleContainer.classList.add("hidden");
    if (noteFooterContainer) noteFooterContainer.classList.add("hidden");
    if (takeNoteWrapper) takeNoteWrapper.classList.remove("shadow-md");
    if (noteTitleInput) noteTitleInput.value = "";
    if (noteContentInput) noteContentInput.value = "";
}
async function saveNoteAndClear(title, content) {
    try {
        await window.api.saveNote({ title, content, color: "white" });
        loadNotes();
    } catch(e) { console.error(e); }
}

if (noteContentInput) {
    noteContentInput.addEventListener("focus", expandNoteInput);
}
if (closeNoteBtn) {
    closeNoteBtn.addEventListener("click", collapseNoteInput);
}
if (notesTabBtn) {
    notesTabBtn.addEventListener("click", loadNotes);
}
if (refreshNotesBtn) {
    refreshNotesBtn.addEventListener("click", loadNotes);
}

if (noteSearch) {
    noteSearch.addEventListener("input", (e) => {
        const query = e.target.value.toLowerCase();
        const filtered = allNotes.filter(n => 
            (n.title && n.title.toLowerCase().includes(query)) || 
            (n.content && n.content.toLowerCase().includes(query))
        );
        renderNotes(filtered);
    });
}
if (voiceNoteBtn) {
    voiceNoteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        alert("Use your global hotkey (Hold Key) to record!");
    });
}

async function loadNotes() {
    if (!notesGrid) return;
    try {
        allNotes = await window.api.getNotes();
        // Preserves search filter on reload
        if (noteSearch && noteSearch.value.trim()) {
            const query = noteSearch.value.trim().toLowerCase();
            const filtered = allNotes.filter(n => 
                (n.title && n.title.toLowerCase().includes(query)) || 
                (n.content && n.content.toLowerCase().includes(query))
            );
            renderNotes(filtered);
        } else {
            renderNotes(allNotes);
        }
    } catch (e) { console.error(e); }
}

function renderNotes(notes) {
    if (!notes || notes.length === 0) {
        notesGrid.innerHTML = "";
        notesEmptyState.classList.remove("hidden");
        return;
    }
    notesEmptyState.classList.add("hidden");
    notesGrid.innerHTML = "";
    notes.forEach(note => {
        const el = document.createElement("div");
        el.className = "break-inside-avoid bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md mb-4 relative group";
        el.innerHTML = `
            <button class="del-note-btn absolute top-2 right-2 w-6 h-6 rounded-full bg-slate-100 hover:bg-red-100 text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <i class="fa-solid fa-trash text-xs"></i>
            </button>
            ${note.title ? `<h3 class="font-semibold text-slate-800 mb-2">${note.title}</h3>` : ''}
            <p class="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">${note.content || ""}</p>
        `;
        const del = el.querySelector(".del-note-btn");
        del.onclick = async (e) => {
            e.stopPropagation();
            if (confirm("Delete note?")) {
                await window.api.deleteNote(note.id);
                loadNotes();
            }
        };
        notesGrid.appendChild(el);
    });
}

// Utils
function addLog(text, color) {
    if (!logs) return;
    const d = document.createElement("div");
    d.className = "log-item";
    d.style.color = color || "#222";
    d.textContent = text;
    logs.prepend(d);
}

// Init
window.api.getHotkey();
