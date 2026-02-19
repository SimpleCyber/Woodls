// js/app.js
import { addLog, $ } from "./utils.js";
import * as Notes from "./notes.js";
import { initAuth, logout } from "./auth.js";
import { initOnboarding, startOnboarding } from "./onboarding.js";
import { initHelpDeck, syncHelpDeckUser } from "./helpdeck.js";
import { initChats } from "./chats.js";

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

// ---------- AI Hotkey UI ----------
const startAIHotkeyCaptureBtn = document.getElementById("startAIHotkeyCapture");
const clearAIHotkeyBtn = document.getElementById("clearAIHotkey");
const aiHotkeyDisplay = document.getElementById("aiHotkeyDisplay");
let currentAIHotkey = [];

// ---------- Chat Hotkey UI ----------
const startChatHotkeyCaptureBtn = document.getElementById(
  "startChatHotkeyCapture",
);
const clearChatHotkeyBtn = document.getElementById("clearChatHotkey");
const chatHotkeyDisplay = document.getElementById("chatHotkeyDisplay");
let currentChatHotkey = [];

// ---------- Audio / History ----------
const historyList = document.getElementById("history-list");
const historyTabBtn = document.querySelector('[data-page="history"]');

// ---------- Window Controls ----------
const minBtn = document.getElementById("min-btn");
const maxBtn = document.getElementById("max-btn");
const closeBtn = document.getElementById("close-btn");

if (minBtn) minBtn.onclick = () => window.api.minimizeWindow();
if (maxBtn) maxBtn.onclick = () => window.api.maximizeWindow();
if (closeBtn)
  closeBtn.onclick = () => {
    stopActiveAudio();
    window.api.closeWindow();
  };

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
let recordingCancelled = false;
let activeAudioElement = null;
let activePlayBtn = null;

function stopActiveAudio() {
  if (activeAudioElement) {
    activeAudioElement.pause();
    activeAudioElement = null;
  }
  if (activePlayBtn) {
    activePlayBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
    activePlayBtn.title = "Play Recording";
    activePlayBtn = null;
  }
}

// Settings
let useBackspace = true;
let instantPaste = true;
let aiEnhanced = false;
let runOnStartup = true;
let startHidden = true;

const backspaceToggle = document.getElementById("backspaceToggle");
const pasteToggle = document.getElementById("pasteToggle");
const aiToggle = document.getElementById("aiToggle");
const startupToggle = document.getElementById("startupToggle");
const hiddenToggle = document.getElementById("hiddenToggle");
const protectionToggle = document.getElementById("protectionToggle");

const newKeyInput = document.getElementById("newKeyInput");
const addKeyBtn = document.getElementById("addKeyBtn");
const keyListContainer = document.getElementById("key-list-container");
let currentKeys = []; // Array of API keys
let activeKeyIndex = 0; // The key currently used by rotation logic

// ---------- Initialization ----------

// Active Window Tracking
let activeWindowInfo = null;

export function initApp() {
  // Listen for active window updates
  window.api.onActiveWindow((_event, info) => {
    activeWindowInfo = info;
  });

  setupTheme();
  setupSettings();
  setupHotkeyUI();
  setupAIHotkeyUI(); // New
  setupChatHotkeyUI(); // New
  setupRecordingEvents();
  fetchAndDisplayVersion();

  const testOnboardingBtn = document.getElementById("test-onboarding-btn");
  if (testOnboardingBtn) {
    testOnboardingBtn.onclick = () => {
      startOnboarding();
      // Switch back to home or just show modal
      // We'll leave them on settings but show the modal
    };
  }

  // Load History
  setupHistory();
  setupAccount();
  setupUpgradeModal();
  setupDashboard();

  // Init other modules
  Notes.initNotes();
  initChats();
  initOnboarding();
  initHelpDeck();

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
      syncHelpDeckUser(user);

      // Check onboarding for this user
      import("./onboarding.js").then((m) => m.checkAndTriggerOnboarding(user));

      // Re-trigger stats when app starts and user is authorized
      loadStats();
      renderStatsFromCache();
    } else {
      // Logged Out
      if (authPage) authPage.classList.remove("hidden");
      if (contentContainer) contentContainer.classList.add("hidden");
      addLog("Please sign in", "orange");
      syncHelpDeckUser(null);
    }
  });

  // Auto-Update Feedback
  const updateStats = document.getElementById("update-status-text");
  const checkUpdatesBtn = document.getElementById("check-updates-btn");
  const updateDot = document.getElementById("update-dot");

  if (updateStats) {
    window.api.onUpdateStatus((data) => {
      const { status, details } = data;
      if (status === "checking") {
        updateStats.textContent = "Checking for updates...";
        updateStats.className =
          "text-[10px] text-primary-500 font-bold uppercase tracking-wider mb-2";
      } else if (status === "available") {
        updateStats.textContent = `Update available: v${details}`;
        updateStats.className =
          "text-[10px] text-amber-500 font-bold uppercase tracking-wider mb-2 animate-pulse";
        if (updateDot) updateDot.classList.remove("hidden");
      } else if (status === "up-to-date") {
        updateStats.textContent = `Woodls is up to date (v${details})`;
        updateStats.className =
          "text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2";
        if (updateDot) updateDot.classList.add("hidden");
      } else if (status === "downloading") {
        updateStats.textContent = `Downloading update: ${details}%`;
        updateStats.className =
          "text-[10px] text-blue-500 font-bold uppercase tracking-wider mb-2";
        if (updateDot) updateDot.classList.remove("hidden");
      } else if (status === "downloaded") {
        updateStats.textContent = `Version ${details} ready to install!`;
        updateStats.className =
          "text-[10px] text-green-600 font-bold uppercase tracking-wider mb-2";
        if (updateDot) updateDot.classList.remove("hidden");
        if (checkUpdatesBtn) {
          checkUpdatesBtn.innerHTML =
            '<i class="fa-solid fa-circle-check"></i> <span>Restart to Update</span>';
          checkUpdatesBtn.classList.replace("bg-slate-50", "bg-green-50");
          checkUpdatesBtn.classList.replace("text-slate-600", "text-green-600");
          checkUpdatesBtn.classList.replace(
            "border-slate-200",
            "border-green-200",
          );
          checkUpdatesBtn.onclick = () => window.api.quitAndInstall(); // This will trigger the quitAndInstall dialog if it popped up, or just close and let main handle it
        }
      } else if (status === "error") {
        updateStats.textContent = details
          ? `Error: ${details}`
          : "Update check failed";
        updateStats.className =
          "text-[10px] text-red-500 font-bold uppercase tracking-wider mb-2";
      }
    });

    if (checkUpdatesBtn) {
      checkUpdatesBtn.onclick = async () => {
        const originalHtml = checkUpdatesBtn.innerHTML;
        checkUpdatesBtn.disabled = true;
        checkUpdatesBtn.innerHTML =
          '<i class="fa-solid fa-spinner fa-spin"></i> <span>Checking...</span>';
        await window.api.checkForUpdates();
        setTimeout(() => {
          checkUpdatesBtn.disabled = false;
          checkUpdatesBtn.innerHTML = originalHtml;
        }, 3000);
      };
    }

    // Dev Log Display (only shows for developer account)
    const devLogContainer = document.createElement("div");
    devLogContainer.id = "dev-log-container";
    devLogContainer.className =
      "hidden mt-4 p-3 bg-slate-900 rounded-lg max-h-48 overflow-y-auto";
    devLogContainer.innerHTML =
      '<div class="text-[10px] text-slate-400 font-mono" id="dev-log-content"></div>';
    updateStats?.parentNode?.appendChild(devLogContainer);

    window.api.onDevLog((msg) => {
      const container = document.getElementById("dev-log-container");
      const content = document.getElementById("dev-log-content");
      if (container && content) {
        container.classList.remove("hidden");
        const line = document.createElement("div");
        line.className = "text-[10px] text-green-400 font-mono py-0.5";
        line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
        content.appendChild(line);
        container.scrollTop = container.scrollHeight;
      }
    });
  }

  // Tab Switching

  // Tab Switching
  document
    .querySelectorAll(".sidebar-item, .sidebar-item-link")
    .forEach((item) => {
      item.addEventListener("click", (e) => {
        if (e.currentTarget.tagName === "A" && e.currentTarget.href !== "#")
          return;

        stopActiveAudio();

        document
          .querySelectorAll(".sidebar-item")
          .forEach((i) => i.classList.remove("active"));
        document
          .querySelectorAll(".page")
          .forEach((p) => p.classList.add("hidden"));

        // Find the related sidebar item if this is a link
        const page = item.dataset.page;
        const sidebarItem = document.querySelector(
          `.sidebar-item[data-page="${page}"]`,
        );
        if (sidebarItem) {
          sidebarItem.classList.add("active");
        } else if (item.classList.contains("sidebar-item")) {
          item.classList.add("active");
        }

        const pEl = document.getElementById(page);
        if (pEl) pEl.classList.remove("hidden");
      });
    });

  // Initial Fetch
  window.api.getHotkey();
  window.api.getAIHotkey(); // New
  window.api.getChatHotkey(); // New
}

function setupSettings() {
  window.api.onSettingsLoaded((_, settings) => {
    if (settings) {
      if (typeof settings.useBackspace === "boolean")
        useBackspace = settings.useBackspace;
      if (typeof settings.instantPaste === "boolean")
        instantPaste = settings.instantPaste;
      if (typeof settings.aiEnhanced === "boolean")
        aiEnhanced = settings.aiEnhanced;

      if (backspaceToggle) backspaceToggle.checked = useBackspace;
      if (pasteToggle) pasteToggle.checked = instantPaste;
      if (aiToggle) aiToggle.checked = aiEnhanced;

      // Load API Settings
      if (Array.isArray(settings.apiKey)) {
        currentKeys = settings.apiKey;
      } else if (
        typeof settings.apiKey === "string" &&
        settings.apiKey.trim()
      ) {
        currentKeys = settings.apiKey
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
      } else {
        currentKeys = [];
      }
      renderKeyList();

      if (modelNameInput) modelNameInput.value = settings.modelName || "";
    }
  });

  window.api.onStartupSettingsLoaded((_, settings) => {
    if (settings) {
      runOnStartup = settings.openAtLogin;
      startHidden = settings.startHidden;

      if (startupToggle) startupToggle.checked = runOnStartup;
      if (hiddenToggle) hiddenToggle.checked = startHidden;

      // Screen Protection
      const screenProtection =
        settings.screenProtection !== undefined
          ? settings.screenProtection
          : true; // Default to true
      if (protectionToggle) protectionToggle.checked = screenProtection;
    }

    // Load API Settings
    if (settings) {
      if (Array.isArray(settings.apiKey)) {
        currentKeys = settings.apiKey;
      } else if (
        typeof settings.apiKey === "string" &&
        settings.apiKey.trim()
      ) {
        currentKeys = settings.apiKey
          .split(",")
          .map((k) => k.trim())
          .filter((k) => k.length > 0);
      }
      renderKeyList();
      if (modelNameInput) modelNameInput.value = settings.modelName || "";
    }
  });

  // Request initial startup settings
  window.api.getStartupSettings();

  if (backspaceToggle) {
    backspaceToggle.onchange = () => {
      useBackspace = backspaceToggle.checked;
      window.api.saveSetting("useBackspace", useBackspace);
    };
  }
  if (pasteToggle) {
    pasteToggle.onchange = () => {
      instantPaste = pasteToggle.checked;
      window.api.saveSetting("instantPaste", instantPaste);
    };
  }
  if (aiToggle) {
    aiToggle.onchange = () => {
      aiEnhanced = aiEnhanced = aiToggle.checked;
      window.api.saveSetting("aiEnhanced", aiEnhanced);
    };
  }

  const updateStartup = () => {
    runOnStartup = startupToggle ? startupToggle.checked : false;
    startHidden = hiddenToggle ? hiddenToggle.checked : false;
    window.api.setStartupSettings({ openAtLogin: runOnStartup, startHidden });
  };

  if (startupToggle) startupToggle.onchange = updateStartup;
  if (hiddenToggle) hiddenToggle.onchange = updateStartup;

  if (protectionToggle) {
    protectionToggle.onchange = () => {
      const enabled = protectionToggle.checked;
      window.api.saveSetting("screenProtection", enabled);
      // We also need to notify the main process to apply it to all windows immediately
      if (window.api.setScreenProtection) {
        window.api.setScreenProtection(enabled);
      }
    };
  }

  const aiUsageBadge = document.getElementById("ai-usage-badge");
  const aiUsageCount = document.getElementById("ai-usage-count");
  const aiKeyIndex = document.getElementById("ai-key-index");

  function updateAIUI(data) {
    if (!data) return;
    activeKeyIndex = data.keyIndex || 0;

    if (modelNameInput) {
      modelNameInput.value = data.currentModel || "";
      modelNameInput.placeholder = data.currentModel || "gemini-2.5-flash-lite";
    }
    if (aiUsageBadge && aiUsageCount) {
      aiUsageCount.textContent = data.usage || 0;
      if (aiKeyIndex && data.totalKeys > 1) {
        aiKeyIndex.textContent = `K${(data.keyIndex || 0) + 1}`;
        aiKeyIndex.classList.remove("hidden");
      } else if (aiKeyIndex) {
        aiKeyIndex.classList.add("hidden");
      }
      aiUsageBadge.classList.remove("hidden");
    }
    renderKeyList(); // Re-render to show active highlight
  }

  // AI Info Updates from Main
  window.api.onAIInfoUpdate((data) => {
    updateAIUI(data);
  });

  // Initial load
  window.api.getAIInfo().then(updateAIUI);

  // API Config Listeners
  if (addKeyBtn) {
    addKeyBtn.onclick = () => {
      const val = newKeyInput.value.trim();
      if (!val) return;
      currentKeys.push(val);
      newKeyInput.value = "";
      window.api.saveSetting("apiKey", currentKeys);
      renderKeyList();
    };
  }
  // Enter key to add
  if (newKeyInput) {
    newKeyInput.onkeydown = (e) => {
      if (e.key === "Enter") {
        addKeyBtn.click();
      }
    };
  }

  function renderKeyList() {
    if (!keyListContainer) return;
    keyListContainer.innerHTML = "";

    if (currentKeys.length === 0) {
      keyListContainer.innerHTML = `<div class="text-xs text-slate-400 italic py-2">No API keys added yet.</div>`;
      return;
    }

    currentKeys.forEach((key, index) => {
      const isActive = index === activeKeyIndex;
      const masked =
        key.length > 6
          ? `${key.slice(0, 2)}****************${key.slice(-4)}`
          : "****************";

      const div = document.createElement("div");
      const borderClass = isActive
        ? "border-primary-500 bg-primary-50/30"
        : "border-slate-200 bg-slate-50";
      div.className = `flex items-center gap-2 border rounded-lg p-2.5 group transition-all ${borderClass}`;

      div.innerHTML = `
                <div class="flex-1 font-mono text-[10px] text-slate-600 truncate key-display" data-full="${key}" data-masked="${masked}">
                    ${masked}
                </div>
                ${isActive ? '<span class="text-[9px] bg-primary-500 text-white px-1.5 py-0.5 rounded font-bold uppercase tracking-tighter">Active</span>' : ""}
                <button class="toggle-visibility text-slate-400 hover:text-primary-500 transition-colors px-1" title="Show/Hide">
                    <i class="fa-solid fa-eye text-xs"></i>
                </button>
                <button class="remove-key text-slate-400 hover:text-red-500 transition-colors px-1" title="Remove">
                    <i class="fa-solid fa-trash-can text-xs"></i>
                </button>
            `;

      const toggleBtn = div.querySelector(".toggle-visibility");
      const keyEl = div.querySelector(".key-display");
      toggleBtn.onclick = () => {
        const isMasked = keyEl.textContent.trim() === masked;
        keyEl.textContent = isMasked ? key : masked;
        toggleBtn.innerHTML = isMasked
          ? `<i class="fa-solid fa-eye-slash text-xs"></i>`
          : `<i class="fa-solid fa-eye text-xs"></i>`;
      };

      const removeBtn = div.querySelector(".remove-key");
      removeBtn.onclick = () => {
        currentKeys.splice(index, 1);
        window.api.saveSetting("apiKey", currentKeys);
        renderKeyList();
      };

      keyListContainer.appendChild(div);
    });
  }

  if (modelNameInput) {
    modelNameInput.onchange = () => {
      window.api.saveSetting("modelName", modelNameInput.value.trim());
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
            <b>App:</b> ${info.owner ? info.owner.name || "—" : "—"}<br>
            <b>PID:</b> ${info.owner ? info.owner.processId || "—" : "—"}
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

      if (window.capturingAI) {
        window.api.saveAIHotkey([keyToSave]);
        window.capturingAI = false;
      } else if (window.capturingChat) {
        window.api.saveChatHotkey([keyToSave]);
        window.capturingChat = false;
      } else {
        window.api.saveHotkey([keyToSave]);
      }

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
    if (capturedKeysSpan)
      capturedKeysSpan.textContent = JSON.stringify(Array.from(captured));
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

function setupAIHotkeyUI() {
  if (startAIHotkeyCaptureBtn) {
    startAIHotkeyCaptureBtn.onclick = () => {
      // Re-use existing capture overlay logic but targeting AI Hotkey
      capturing = true;
      captured.clear();
      capturedKeysSpan.textContent = "[]";
      captureArea.classList.remove("hidden");
      captureArea.style.display = "flex";
      addLog("Capturing AI hotkey...", "purple");
      window.focus();

      // Temporarily override save button behavior?
      // Better: check which button launched capture? or just use a flag
      window.capturingAI = true;
    };
  }

  // Update save logic in setupHotkeyUI to handle flag
  if (clearAIHotkeyBtn) {
    clearAIHotkeyBtn.onclick = () => window.api.clearAIHotkey();
  }

  window.api.onAIHotkeyLoaded((_, keys) => {
    currentAIHotkey = keys || [];
    updateAIHotkeyDisplay(currentAIHotkey);
  });
  window.api.onAIHotkeySaved((_, keys) => {
    currentAIHotkey = keys || [];
    updateAIHotkeyDisplay(currentAIHotkey);
    addLog("AI Hotkey saved", "purple");
  });
  window.api.onAIHotkeyCleared(() => {
    currentAIHotkey = [];
    updateAIHotkeyDisplay([]);
    addLog("AI Hotkey cleared", "red");
  });
}

function updateAIHotkeyDisplay(keys) {
  if (aiHotkeyDisplay) {
    if (keys && keys.length > 0) {
      aiHotkeyDisplay.textContent = keys[0];
      aiHotkeyDisplay.classList.remove("text-slate-500", "italic");
      aiHotkeyDisplay.classList.add("text-purple-600", "font-bold");
    } else {
      aiHotkeyDisplay.textContent = "Set AI Hotkey";
      aiHotkeyDisplay.classList.remove("text-purple-600", "font-bold");
      aiHotkeyDisplay.classList.add("text-slate-500", "italic");
    }
  }
}

function updateHotkeyDisplay(keys) {
  const targets = document.querySelectorAll(".hotkey-dynamic-text");
  targets.forEach((el) => {
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
    hotkeyDisplay.textContent = keys.length
      ? keys.join(" + ")
      : "No hotkey set";
  }
}

function setupChatHotkeyUI() {
  if (startChatHotkeyCaptureBtn) {
    startChatHotkeyCaptureBtn.onclick = () => {
      capturing = true;
      captured.clear();
      capturedKeysSpan.textContent = "[]";
      captureArea.classList.remove("hidden");
      captureArea.style.display = "flex";
      addLog("Capturing chat hotkey...", "blue");
      window.focus();

      window.capturingChat = true;
    };
  }

  if (clearChatHotkeyBtn) {
    clearChatHotkeyBtn.onclick = () => window.api.clearChatHotkey();
  }

  window.api.onChatHotkeyLoaded((_, keys) => {
    currentChatHotkey = keys || [];
    updateChatHotkeyDisplay(currentChatHotkey);
  });
  window.api.onChatHotkeySaved((_, keys) => {
    currentChatHotkey = keys || [];
    updateChatHotkeyDisplay(currentChatHotkey);
    addLog("Chat Hotkey saved", "blue");
  });
  window.api.onChatHotkeyCleared(() => {
    currentChatHotkey = [];
    updateChatHotkeyDisplay([]);
    addLog("Chat Hotkey cleared", "red");
  });
}

function updateChatHotkeyDisplay(keys) {
  if (chatHotkeyDisplay) {
    if (keys && keys.length > 0) {
      chatHotkeyDisplay.textContent = keys[0];
      chatHotkeyDisplay.classList.remove("text-slate-500", "italic");
      chatHotkeyDisplay.classList.add("text-blue-600", "font-bold");
    } else {
      chatHotkeyDisplay.textContent = "Set Chat Hotkey";
      chatHotkeyDisplay.classList.remove("text-blue-600", "font-bold");
      chatHotkeyDisplay.classList.add("text-slate-500", "italic");
    }
  }
}

function setupRecordingEvents() {
  window.api.onRecordStart(async (_, params) => {
    addLog("Recording started", "green");

    // Determine AI Mode for this session
    // If params.aiMode is explicitly set (true/false), use it.
    // Otherwise fallback to global setting `aiEnhanced`
    let sessionAIMode = aiEnhanced;
    if (params && typeof params.aiMode === "boolean") {
      sessionAIMode = params.aiMode;
    }

    // Pass session mode to overlay?
    // The main process handles overlay visual mode via show-overlay(aiEnabled)
    // We should probably rely on main's logic for overlay toggle,
    // but we need to know for transcription/generation.

    // Wait, the main process calls show-overlay with specific flags.
    // We don't control the overlay show here, checking index.js...
    // Actually index.js sends 'record-start' AND calls `win.webContents.send("set-ai-status", ...)` in show-overlay IPC
    // But wait, the main process calls `win.webContents.send("record-start")`
    // And WE call `window.api.showOverlay(aiEnhanced)` here on line 597!

    // Correction: We need to pass the determined mode to showOverlay
    window.api.showOverlay(sessionAIMode);

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder = new MediaRecorder(mediaStream);
      chunks = [];

      // Audio Feedback: Start (Ping)
      const startAudio = new Audio("webp/buttonpressed.mp3");
      startAudio.volume = 0.5;
      startAudio.play().catch((e) => console.error("Audio feedback error:", e));

      // Audio Context for Enhanced Voice Visualizer
      audioContext = new AudioContext();
      await audioContext.resume();
      audioSource = audioContext.createMediaStreamSource(mediaStream);
      audioAnalyser = audioContext.createAnalyser();
      // Higher fftSize for better frequency resolution (voice range 85Hz-255Hz)
      audioAnalyser.fftSize = 256;
      audioAnalyser.smoothingTimeConstant = 0.3; // Smooth transitions
      audioSource.connect(audioAnalyser);

      const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);
      // Store previous values for smooth interpolation
      let prevBarValues = [0.1, 0.15, 0.2, 0.15, 0.1];
      const smoothingFactor = 0.35; // How much to blend with previous values

      const updateVolume = () => {
        if (!mediaRecorder || mediaRecorder.state === "inactive") return;
        audioAnalyser.getByteFrequencyData(dataArray);

        // Voice-optimized frequency bands (focus on 100Hz-3000Hz for speech)
        // Sample rate is typically 48000Hz, so each bin ≈ 187.5Hz (48000/256)
        // We'll target voice frequency ranges for more responsive motion
        const binRanges = [
          { start: 0, end: 2, weight: 0.8 }, // Low bass (0-375Hz)
          { start: 2, end: 6, weight: 1.2 }, // Low-mid (375-1125Hz) - fundamental voice
          { start: 6, end: 12, weight: 1.5 }, // Mid (1125-2250Hz) - primary voice range
          { start: 12, end: 20, weight: 1.2 }, // High-mid (2250-3750Hz) - harmonics
          { start: 20, end: 32, weight: 0.8 }, // High (3750Hz+) - sibilants
        ];

        const barValues = binRanges.map((range, barIndex) => {
          let sum = 0;
          let count = 0;
          for (
            let j = range.start;
            j < Math.min(range.end, dataArray.length);
            j++
          ) {
            sum += dataArray[j];
            count++;
          }
          if (count === 0) return prevBarValues[barIndex];

          // Apply weight and normalize
          const average = (sum / count) * range.weight;
          let normalizedValue = Math.min(average / 120, 1.0);

          // Apply minimum threshold to avoid dead bars
          normalizedValue = Math.max(normalizedValue, 0.05);

          // Smooth blending with previous value for natural motion
          const smoothed =
            prevBarValues[barIndex] * smoothingFactor +
            normalizedValue * (1 - smoothingFactor);

          // Add slight random variation for organic feel
          const jitter = (Math.random() - 0.5) * 0.08;
          return Math.max(0.05, Math.min(1.0, smoothed + jitter));
        });

        // Update previous values for next frame
        prevBarValues = [...barValues];

        window.api.sendMicVolume(barValues);
        animationFrameId = requestAnimationFrame(updateVolume);
      };
      updateVolume();

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      let isProcessing = false;

      mediaRecorder.onstop = async () => {
        if (isProcessing) return;
        isProcessing = true;

        // Cleanup Audio Context & Stream here to ensure recording finishes
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        if (audioContext) audioContext.close();
        if (mediaStream)
          mediaStream.getTracks().forEach((track) => track.stop());

        if (recordingCancelled) {
          addLog("Recording cancelled", "red");
          recordingCancelled = false;
          window.api.hideOverlay();
          return;
        }

        window.api.processingStart();

        try {
          const blob = new Blob(chunks, { type: "audio/webm" });
          lastArrayBuffer = await blob.arrayBuffer();

          addLog("Transcribing...", "purple");

          // Context for Normal Mode Enhancement
          const context = {
            appName: activeWindowInfo?.owner?.name || "Unknown App",
            windowTitle: activeWindowInfo?.title || "",
          };

          const result = await window.api.transcribeAudio(
            lastArrayBuffer,
            context,
          );

          if (recordingCancelled) {
            addLog("Processing cancelled", "red");
            recordingCancelled = false;
            return;
          }

          const text = result.text;
          const historyId = result.id;

          let finalOutput = text;

          if (sessionAIMode) {
            addLog("Processing AI task...", "green");
            finalOutput = await window.api.generateText({
              info: text,
              assistantName: assistantName ? assistantName.value : "Assistant",
              appName: appName ? appName.value : "Desktop App",
            });

            if (recordingCancelled) {
              addLog("Processing cancelled", "red");
              recordingCancelled = false;
              return;
            }

            // Update history with enhanced text
            await window.api.updateHistoryItem({
              id: historyId,
              text: finalOutput,
              isAI: true,
            });
          } else {
            addLog("Refinement disabled, using raw transcript", "gray");
          }

          // Helper: Detect if likely in an input field based on window info
          function isLikelyInputField(windowInfo) {
            if (!windowInfo) return false;

            const title = (windowInfo.title || "").toLowerCase();
            const appName = (windowInfo.owner?.name || "").toLowerCase();

            // Apps that are always input-focused
            const inputApps = [
              "code",
              "cursor",
              "windsurf",
              "antigravity",
              "notion",
              "slack",
              "discord",
              "teams",
              "obsidian",
              "notepad",
            ];
            if (inputApps.some((app) => appName.includes(app))) return true;

            // Title keywords suggesting input
            const inputKeywords = [
              "sign in",
              "login",
              "search",
              "comment",
              "reply",
              "message",
              "edit",
              "write",
              "compose",
              "new message",
            ];
            if (inputKeywords.some((kw) => title.includes(kw))) return true;

            return false;
          }

          // Check if Notes is active
          const isNotesActive = document.querySelector(
            '[data-page="notes"].active',
          );

          if (isNotesActive) {
            // Delegate to Notes module
            Notes.handleVoiceInput(finalOutput);
          } else {
            // Smart Logic: Check active window
            // If explorer (Desktop/Taskbar) or Search -> Show Copy Popup
            // But if likely in an input field -> Auto-type instead
            let showPopup = false;

            if (activeWindowInfo && activeWindowInfo.owner) {
              const procName = activeWindowInfo.owner.name; // e.g. "explorer.exe", "SearchApp.exe"
              // Windows specific check
              if (
                procName === "Windows Explorer" ||
                procName === "explorer.exe" ||
                procName === "SearchApp.exe" ||
                procName === "SearchHost.exe" ||
                procName === "LockApp.exe"
              ) {
                showPopup = true;
              }
            }

            // Override: Don't show popup if likely in an input field
            if (showPopup && isLikelyInputField(activeWindowInfo)) {
              showPopup = false;
              addLog("Input field detected, auto-typing instead", "blue");
            }

            // Broadcast for Onboarding (or other listeners)
            document.dispatchEvent(
              new CustomEvent("woodls-transcription", {
                detail: { text: finalOutput },
              }),
            );

            if (showPopup) {
              window.api.showCopyPopup(finalOutput);
              addLog("Ready to copy", "cyan");
            } else {
              // Default: Auto-type
              if (useBackspace) {
                await window.api.sendBackspace();
                await new Promise((r) => setTimeout(r, 50));
              }
              if (instantPaste) {
                await window.api.pasteString(finalOutput);
                addLog("Pasted", "green");
              } else {
                await window.api.autoType(finalOutput);
                addLog("Auto-typed", "green");
              }
            }
          }
        } catch (err) {
          console.error("Transcription error:", err);
          addLog("Error: " + err.message, "red");
        } finally {
          window.api.processingEnd();
          loadStats(); // Update dashboard stats immediately after transcription
        }
      };

      mediaRecorder.start();
    } catch (err) {
      addLog("Rec Start Error: " + err, "red");
      window.api.hideOverlay();
    }
  });

  window.api.onRecordStop(() => {
    addLog("Recording stopped", "orange");

    // Audio Feedback: Stop (Ting-Ting)
    const stopAudio = new Audio("webp/buttonpressed.mp3");
    stopAudio.volume = 0.5;
    stopAudio
      .play()
      .then(() => {
        setTimeout(() => {
          const stopAudio2 = new Audio("webp/buttonpressed.mp3");
          stopAudio2.volume = 0.5;
          stopAudio2
            .play()
            .catch((e) => console.error("Audio feedback 2 error:", e));
        }, 150); // 150ms delay for double tap effect
      })
      .catch((e) => console.error("Audio feedback error:", e));

    try {
      if (mediaRecorder && mediaRecorder.state !== "inactive") {
        mediaRecorder.stop();
      }
      // Cleanup handled in onstop
    } catch (err) {
      console.error(err);
    }
  });

  window.api.onRecordingCancelled(() => {
    recordingCancelled = true;
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
    }
  });
}

function setupHistory() {
  if (historyTabBtn) {
    historyTabBtn.addEventListener("click", loadHistory);
  }
}

async function loadHistory() {
  if (!historyList) return;
  historyList.innerHTML =
    '<div class="text-center text-slate-400 py-10">Loading...</div>';
  try {
    const history = await window.api.getHistory();
    renderHistory(history);
  } catch (e) {
    historyList.innerHTML =
      '<div class="text-center text-red-400 py-10">Error</div>';
  }
}

function renderHistory(items) {
  if (!items || items.length === 0) {
    historyList.innerHTML =
      '<div class="text-center text-slate-400 py-10">No history yet.</div>';
    return;
  }
  historyList.innerHTML = "";
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className =
      "timeline-item relative pl-6 border-l-2 border-slate-100 pb-8 last:pb-0";
    div.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center gap-2">
                    <div class="text-[10px] uppercase font-bold text-slate-400">${new Date(item.timestamp).toLocaleString()}</div>
                    ${item.isAI ? '<span class="text-xs" title="Processed by AI Assistant">🤖</span>' : ""}
                </div>
                <div class="flex gap-2">
                    <button class="retranscribe-btn text-slate-300 hover:text-primary-500 transition-colors" title="Retranscribe"><i class="fa-solid fa-arrows-rotate"></i></button>
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
    const reBtn = div.querySelector(".retranscribe-btn");

    if (reBtn) {
      reBtn.onclick = async () => {
        reBtn.classList.add("animate-spin", "text-primary-500");
        const result = await window.api.retranscribeAudio(item.id);
        reBtn.classList.remove("animate-spin", "text-primary-500");
        if (result && typeof result === "string") {
          addLog("Retranscription complete", "green");
          loadHistory();
          loadStats();
        } else {
          addLog("Retranscription failed", "red");
        }
      };
    }

    if (delBtn) {
      delBtn.onclick = () => {
        const modal = document.getElementById("history-delete-modal");
        const confirmBtn = document.getElementById(
          "confirm-history-delete-btn",
        );
        const cancelBtn = document.getElementById("cancel-history-delete-btn");

        // Show modal
        if (modal) modal.classList.remove("hidden");

        // Handle confirm
        const handleConfirm = async () => {
          await window.api.deleteHistoryItem(item.id);
          loadHistory();
          loadStats(); // Update dashboard stats after deletion
          if (modal) modal.classList.add("hidden");
          cleanup();
        };

        // Handle cancel
        const handleCancel = () => {
          if (modal) modal.classList.add("hidden");
          cleanup();
        };

        // Cleanup listeners
        const cleanup = () => {
          if (confirmBtn)
            confirmBtn.removeEventListener("click", handleConfirm);
          if (cancelBtn) cancelBtn.removeEventListener("click", handleCancel);
          if (modal) modal.removeEventListener("click", handleModalClick);
        };

        // Close on backdrop click
        const handleModalClick = (e) => {
          if (e.target === modal) handleCancel();
        };

        // Attach listeners
        if (confirmBtn) confirmBtn.addEventListener("click", handleConfirm);
        if (cancelBtn) cancelBtn.addEventListener("click", handleCancel);
        if (modal) modal.addEventListener("click", handleModalClick);
      };
    }
    if (playBtn) {
      playBtn.onclick = async () => {
        if (!item.audioPath) return alert("No audio file found.");

        // If clicking the currently active one
        if (activeAudioElement && activePlayBtn === playBtn) {
          if (activeAudioElement.paused) {
            activeAudioElement.play();
            playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            playBtn.title = "Pause Recording";
          } else {
            activeAudioElement.pause();
            playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
            playBtn.title = "Play Recording";
          }
          return;
        }

        // If another audio is playing, stop it
        stopActiveAudio();

        // Load and play new audio
        try {
          const b64 = await window.api.readAudioFile(item.audioPath);
          if (b64) {
            activeAudioElement = new Audio("data:audio/webm;base64," + b64);
            activePlayBtn = playBtn;

            activeAudioElement.onended = () => {
              playBtn.innerHTML = '<i class="fa-solid fa-play"></i>';
              playBtn.title = "Play Recording";
              activeAudioElement = null;
              activePlayBtn = null;
            };

            activeAudioElement.play();
            playBtn.innerHTML = '<i class="fa-solid fa-pause"></i>';
            playBtn.title = "Pause Recording";
          } else {
            alert("Audio file missing on disk.");
          }
        } catch (e) {
          console.error(e);
        }
      };
    }
    if (copyBtn) {
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(item.text);
        copyBtn.innerHTML = '<i class="fa-solid fa-check"></i>';
        setTimeout(
          () => (copyBtn.innerHTML = '<i class="fa-solid fa-copy"></i>'),
          1500,
        );
      };
    }
    historyList.appendChild(div);
  });
}

function setupAccount() {
  const logoutBtn = document.getElementById("logout-option"); // Changed ID in HTML
  const oldLogoutBtn = document.getElementById("logout-btn"); // For About page

  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await logout();
      window.location.reload();
    };
  }
  if (oldLogoutBtn)
    oldLogoutBtn.onclick = async () => {
      await logout();
      window.location.reload();
    };

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
      if (
        !popup.classList.contains("hidden") &&
        !btn.contains(e.target) &&
        !popup.contains(e.target)
      ) {
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
    if (nameEl) nameEl.textContent = "Guest";
    if (emailEl) emailEl.textContent = "Sign In";
    if (avatarEl) avatarEl.innerHTML = '<i class="fa-solid fa-user"></i>';
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
      const colors = [
        "bg-red-100 text-red-600",
        "bg-blue-100 text-blue-600",
        "bg-green-100 text-green-600",
        "bg-amber-100 text-amber-600",
        "bg-purple-100 text-purple-600",
      ];
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
      if (userMenu) userMenu.classList.add("hidden");
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

// ========== THEME MANAGEMENT ==========

function setupTheme() {
  const themeLightBtn = document.getElementById("theme-light");
  const themeDarkBtn = document.getElementById("theme-dark");
  const themeSystemBtn = document.getElementById("theme-system");

  // Load saved theme or default to 'system'
  const savedTheme = localStorage.getItem("theme") || "system";
  applyTheme(savedTheme);
  updateThemeButtons(savedTheme);

  // Event listeners
  if (themeLightBtn) {
    themeLightBtn.onclick = () => {
      setTheme("light");
    };
  }

  if (themeDarkBtn) {
    themeDarkBtn.onclick = () => {
      setTheme("dark");
    };
  }

  if (themeSystemBtn) {
    themeSystemBtn.onclick = () => {
      setTheme("system");
    };
  }

  // Listen for system theme changes
  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  mediaQuery.addEventListener("change", (e) => {
    const currentTheme = localStorage.getItem("theme") || "system";
    if (currentTheme === "system") {
      applyTheme("system");
    }
  });
}

function setTheme(theme) {
  localStorage.setItem("theme", theme);
  applyTheme(theme);
  updateThemeButtons(theme);
  addLog(`Theme changed to ${theme}`, "blue");
}

function applyTheme(theme) {
  const html = document.documentElement;

  if (theme === "system") {
    // Detect system preference
    const prefersDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;
    if (prefersDark) {
      html.setAttribute("data-theme", "dark");
    } else {
      html.removeAttribute("data-theme");
    }
  } else if (theme === "dark") {
    html.setAttribute("data-theme", "dark");
  } else {
    html.removeAttribute("data-theme");
  }
}

function updateThemeButtons(theme) {
  const buttons = {
    light: document.getElementById("theme-light"),
    dark: document.getElementById("theme-dark"),
    system: document.getElementById("theme-system"),
  };

  // Remove active state from all
  Object.values(buttons).forEach((btn) => {
    if (btn) {
      btn.classList.remove("border-primary-500", "bg-primary-50");
      btn.classList.add("border-slate-200");
    }
  });

  // Add active state to selected
  const activeBtn = buttons[theme];
  if (activeBtn) {
    activeBtn.classList.remove("border-slate-200");
    activeBtn.classList.add("border-primary-500", "bg-primary-50");
  }
}

function setupDashboard() {
  const homeTabBtn = document.querySelector('[data-page="home"]');
  if (homeTabBtn) {
    homeTabBtn.addEventListener("click", () => {
      loadStats();
    });
  }

  // Load from cache first for immediate display
  renderStatsFromCache();

  // Initial fetch from backend
  loadStats();
}

function renderStatsFromCache() {
  const cached = localStorage.getItem("dashboard_stats");
  if (cached) {
    try {
      const stats = JSON.parse(cached);
      renderStatsUI(stats, true); // Always animate from 0 on initial load as requested
    } catch (e) {
      console.error("Failed to parse cached stats", e);
    }
  }
}

function renderStatsUI(stats, animate = true) {
  if (!stats) return;

  // Calculate hours/minutes
  const hours = Math.floor(stats.totalDurationMs / 3600000);
  const mins = Math.floor((stats.totalDurationMs % 3600000) / 60000);

  // Calculate time saved hours/minutes
  const savedHours = Math.floor(stats.timeSavedMinutes / 60);
  const savedMins = Math.floor(stats.timeSavedMinutes % 60);

  if (animate) {
    // Animate from current values if they exist
    const parseVal = (id) =>
      parseInt(
        document.getElementById(id)?.textContent?.replace(/,/g, "") || "0",
      );

    animateValue(
      document.getElementById("stat-hours"),
      parseVal("stat-hours"),
      hours,
      1000,
    );
    animateValue(
      document.getElementById("stat-minutes"),
      parseVal("stat-minutes"),
      mins,
      1000,
    );
    animateValue(
      document.getElementById("stat-words"),
      parseVal("stat-words"),
      stats.totalWords,
      1200,
    );
    animateValue(
      document.getElementById("stat-saved-hours"),
      parseVal("stat-saved-hours"),
      savedHours,
      1000,
    );
    animateValue(
      document.getElementById("stat-saved-minutes"),
      parseVal("stat-saved-minutes"),
      savedMins,
      1000,
    );
    animateValue(
      document.getElementById("stat-wpm"),
      parseVal("stat-wpm"),
      Math.round(stats.averageWPM),
      1500,
    );
  } else {
    // Direct set for immediate display
    const setVal = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val.toLocaleString();
    };

    setVal("stat-hours", hours);
    setVal("stat-minutes", mins);
    setVal("stat-words", stats.totalWords);
    setVal("stat-saved-hours", savedHours);
    setVal("stat-saved-minutes", savedMins);
    setVal("stat-wpm", Math.round(stats.averageWPM));
  }
}

async function loadStats() {
  try {
    const stats = await window.api.getStats();
    if (!stats) return;

    // Save to cache
    localStorage.setItem("dashboard_stats", JSON.stringify(stats));

    // Render with animation
    renderStatsUI(stats, true);
  } catch (e) {
    console.error("Failed to load stats:", e);
  }
}

function animateValue(el, start, end, duration) {
  if (!el) return;
  let startTimestamp = null;
  const step = (timestamp) => {
    if (!startTimestamp) startTimestamp = timestamp;
    const progress = Math.min((timestamp - startTimestamp) / duration, 1);
    // Use easeOutQuad for smoother feel
    const easeProgress = 1 - (1 - progress) * (1 - progress);

    const current = Math.floor(easeProgress * (end - start) + start);

    // Format large numbers with commas
    el.textContent = current.toLocaleString();

    if (progress < 1) {
      window.requestAnimationFrame(step);
    }
  };
  window.requestAnimationFrame(step);
}

async function fetchAndDisplayVersion() {
  const version = await window.api.getAppVersion();
  const display = document.getElementById("app-version-display");
  if (display) {
    display.textContent = `Version ${version}`;
  }
}
