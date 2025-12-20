// js/app.js
import { addLog, $ } from './utils.js';
import * as Notes from './notes.js';
import { initAuth, logout } from './auth.js';
import { initOnboarding } from './onboarding.js';

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

// Global State
let capturing = false;
let captured = new Set();
let currentHotkey = [];
let mediaRecorder = null;
let mediaStream = null;
let audioContext = null;
let audioAnalyser = null;
let audioSource = null;
let animationFrameId = null;
let chunks = [];
let lastArrayBuffer = null;

// Settings
let useBackspace = true;
let instantPaste = false;
let aiEnhanced = true;
let runOnStartup = false;
let startHidden = false;

const backspaceToggle = document.getElementById("backspaceToggle");
const pasteToggle = document.getElementById("pasteToggle");
const aiToggle = document.getElementById("aiToggle");
const startupToggle = document.getElementById("startupToggle");
const hiddenToggle = document.getElementById("hiddenToggle");

const apiKeyInput = document.getElementById("apiKeyInput");
const modelNameInput = document.getElementById("modelNameInput");

// ---------- Initialization ----------

export function initApp() {
    setupSettings();
    setupHotkeyUI();
    setupRecordingEvents();
    setupHistory();
    setupAccount();
    setupUpgradeModal();
    
    // Init other modules
    Notes.initNotes();
    initOnboarding();

    // Auth Listener
    initAuth((user) => {
        const authPage = document.getElementById("auth-page");
        const mainInterface = document.querySelector("main"); // Assuming main is inside the flex container
        // actually index.html structure is: 
        // body > title-bar
        // body > div (sidebar + main)
        // body > auth-page
        
        const contentContainer = document.getElementById("content-container");

        if (user) {
            // Logged In
            if (authPage) authPage.classList.add("hidden");
            if (contentContainer) contentContainer.classList.remove("hidden");
            addLog(`Welcome back, ${user.displayName || user.email}`, "green");
            
            updateProfileUI(user);
        } else {
            // Logged Out
            if (authPage) authPage.classList.remove("hidden");
            if (contentContainer) contentContainer.classList.add("hidden");
            addLog("Please sign in", "orange");
        }
    });
    
    // Tab Switching
    
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

    window.api.onStartupSettingsLoaded((_, settings) => {
        if (settings) {
            runOnStartup = settings.openAtLogin;
            startHidden = settings.startHidden;

            if (startupToggle) startupToggle.checked = runOnStartup;
            if (hiddenToggle) hiddenToggle.checked = startHidden;
        }
        
        // Load API Settings
        if (settings) {
            if (apiKeyInput) apiKeyInput.value = settings.apiKey || "";
            if (modelNameInput) modelNameInput.value = settings.modelName || "";
        }
    });

    // Request initial startup settings
    window.api.getStartupSettings();

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
            aiEnhanced = aiEnhanced = aiToggle.checked;
            window.api.saveSetting('aiEnhanced', aiEnhanced);
        };
    }

    const updateStartup = () => {
        runOnStartup = startupToggle ? startupToggle.checked : false;
        startHidden = hiddenToggle ? hiddenToggle.checked : false;
        window.api.setStartupSettings({ openAtLogin: runOnStartup, startHidden });
    };

    if (startupToggle) startupToggle.onchange = updateStartup;
    if (hiddenToggle) hiddenToggle.onchange = updateStartup;

    // API Config Listeners
    if (apiKeyInput) {
        apiKeyInput.onchange = () => {
            window.api.saveSetting('apiKey', apiKeyInput.value.trim());
        };
    }
    if (modelNameInput) {
        modelNameInput.onchange = () => {
             window.api.saveSetting('modelName', modelNameInput.value.trim());
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

          // Audio Context for Visualizer
          audioContext = new AudioContext();
          await audioContext.resume();
          audioSource = audioContext.createMediaStreamSource(mediaStream);
          audioAnalyser = audioContext.createAnalyser();
          audioAnalyser.fftSize = 64;
          audioSource.connect(audioAnalyser);

          const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
          const updateVolume = () => {
             if (!capturing && mediaRecorder.state === "inactive") return;
             audioAnalyser.getByteFrequencyData(dataArray);
             // Average volume
             let values = 0;
             for (let i = 0; i < dataArray.length; i++) {
                 values += dataArray[i];
             }
             const average = values / dataArray.length;
             const vol = Math.min(average / 128, 1); // 0.0 to 1.0 (approx)
             
             window.api.sendMicVolume(vol);
             animationFrameId = requestAnimationFrame(updateVolume);
          };
          updateVolume();
      
          mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) chunks.push(e.data);
          };
      
          mediaRecorder.onstop = async () => {
             // Cleanup Audio Context & Stream here to ensure recording finishes
             if (animationFrameId) cancelAnimationFrame(animationFrameId);
             if (audioContext) audioContext.close();
             if (mediaStream) mediaStream.getTracks().forEach(track => track.stop());

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
          // Cleanup handled in onstop
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
                <div class="flex gap-2">
                    <button class="play-btn text-slate-300 hover:text-slate-700 transition-colors" title="Play Recording"><i class="fa-solid fa-play"></i></button>
                    <button class="copy-btn text-slate-300 hover:text-slate-700 transition-colors" title="Copy Text"><i class="fa-solid fa-copy"></i></button>
                    <button class="del-btn text-slate-300 hover:text-slate-700 transition-colors" title="Delete"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="bg-white border border-slate-100 rounded-xl p-4 shadow-sm text-sm text-slate-700">
                ${item.text || "No text"}
            </div>
        `;
        const delBtn = div.querySelector(".del-btn");
        const playBtn = div.querySelector(".play-btn");
        const copyBtn = div.querySelector(".copy-btn");

        if (delBtn) {
            delBtn.onclick = async () => {
                if (confirm("Delete?")) {
                    await window.api.deleteHistoryItem(item.id);
                    loadHistory();
                }
            };
        }
        if (playBtn) {
            playBtn.onclick = async () => {
                if (!item.audioPath) return alert("No audio file found.");
                try {
                    const b64 = await window.api.readAudioFile(item.audioPath);
                    if (b64) {
                        const snd = new Audio("data:audio/webm;base64," + b64);
                        snd.play();
                    } else {
                        alert("Audio file missing on disk.");
                    }
                } catch(e) { console.error(e); }
            };
        }
        if (copyBtn) {
            copyBtn.onclick = () => {
                navigator.clipboard.writeText(item.text);
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
                setTimeout(() => copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>', 1500);
            };
        }
        historyList.appendChild(div);
    });
}

function setupAccount() {
    const logoutBtn = document.getElementById('logout-option'); // Changed ID in HTML
    const oldLogoutBtn = document.getElementById('logout-btn'); // For About page
    
    if (logoutBtn) {
        logoutBtn.onclick = async () => {
             await logout();
             window.location.reload();
        };
    }
    if (oldLogoutBtn) oldLogoutBtn.onclick = async () => { await logout(); window.location.reload(); };

    setupProfilePopup();
}

function setupProfilePopup() {
    const btn = document.getElementById("user-profile-btn");
    const popup = document.getElementById("user-menu-popup");

    if (btn && popup) {
        btn.onclick = (e) => {
            e.stopPropagation();
            popup.classList.toggle("hidden");
        };

        document.addEventListener("click", (e) => {
            if (!popup.classList.contains("hidden") && !btn.contains(e.target) && !popup.contains(e.target)) {
                popup.classList.add("hidden");
            }
        });
    }
}

function updateProfileUI(user) {
    const nameEl = document.getElementById("user-name-display");
    const emailEl = document.getElementById("user-email-display");
    const avatarEl = document.getElementById("user-avatar");

    if (!user) {
        if(nameEl) nameEl.textContent = "Guest";
        if(emailEl) emailEl.textContent = "Sign In";
        if(avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
        return;
    }

    if (nameEl) nameEl.textContent = user.displayName || "User";
    if (emailEl) emailEl.textContent = user.email || "";

    if (avatarEl) {
        if (user.photoURL) {
            avatarEl.innerHTML = `<img src="${user.photoURL}" class="w-full h-full object-cover">`;
        } else {
            // Initials
            const name = user.displayName || user.email || "U";
            const initial = name.charAt(0).toUpperCase();
            // Random-ish color based on char code
            const colors = ['bg-red-100 text-red-600', 'bg-blue-100 text-blue-600', 'bg-green-100 text-green-600', 'bg-amber-100 text-amber-600', 'bg-purple-100 text-purple-600'];
            const colorClass = colors[name.charCodeAt(0) % colors.length];
            
            avatarEl.className = `w-9 h-9 rounded-full flex items-center justify-center font-bold overflow-hidden border border-slate-200 ${colorClass}`;
            avatarEl.innerText = initial;
        }
    }
}

function setupUpgradeModal() {
    const trigger = document.getElementById("upgrade-trigger-btn");
    const modal = document.getElementById("upgrade-modal");
    const closeBtn = document.getElementById("close-upgrade-btn");

    if (trigger && modal) {
        trigger.onclick = () => {
            modal.classList.remove("hidden");
            // Close the user menu popup
            const userMenu = document.getElementById("user-menu-popup");
            if(userMenu) userMenu.classList.add("hidden");
        };
    }

    if (closeBtn && modal) {
        closeBtn.onclick = () => {
             modal.classList.add("hidden");
        };
    }
    
    // Close on click outside
    if (modal) {
        modal.onclick = (e) => {
            if (e.target === modal) {
                 modal.classList.add("hidden");
            }
        };
    }
}
