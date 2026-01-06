// main.js
const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage } = require("electron");
const path = require("path");
const fs = require("fs");
// ESM-only module - must be dynamically imported for production
let activeWin;
(async () => {
  activeWin = (await import("active-win")).default;
})();
const { GlobalKeyboardListener } = require("node-global-key-listener");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // keep as placeholder
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const robot = require("@jitsi/robotjs");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");



// ---- CONFIG ----
require('dotenv').config();

// Asset Path Helper for Production (app.asar support)
const getAssetPath = (...paths) => {
  return path.join(app.isPackaged ? process.resourcesPath : __dirname, ...paths);
};

let win; // Moved to top to avoid TDZ issues
// ----------------- AI ROTATION -----------------
const DEFAULT_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const AI_USAGE_FILE = path.join(app.getPath("userData"), "ai_usage.json");

function readAIUsage() {
    try {
        const today = new Date().toISOString().split('T')[0];
        if (!fs.existsSync(AI_USAGE_FILE)) return { date: today, keys: {} };
        const raw = fs.readFileSync(AI_USAGE_FILE, "utf8");
        const data = JSON.parse(raw);
        if (data.date !== today || !data.keys) {
            return { date: today, keys: {} };
        }
        return data; // { date, keys: { "0": { "model": count } } }
    } catch (e) {
        return { date: new Date().toISOString().split('T')[0], keys: {} };
    }
}

function saveAIUsage(data) {
    try {
        fs.writeFileSync(AI_USAGE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        console.error("Failed to save AI usage:", e);
    }
}

function updateAIUsage(keyIndex, modelName) {
    const data = readAIUsage();
    if (!data.keys[keyIndex]) data.keys[keyIndex] = {};
    data.keys[keyIndex][modelName] = (data.keys[keyIndex][modelName] || 0) + 1;
    saveAIUsage(data);
    console.log(`[AI] Usage updated for Key #${keyIndex} (${modelName}): ${data.keys[keyIndex][modelName]} calls today`);
    sendAIInfoToRenderer();
}

function getBestModelAndKey(apiKeys, preferredModel) {
    if (!apiKeys || apiKeys.length === 0) return null;
    const data = readAIUsage();
    
    // Rotation Strategy:
    // 1. Iterate through each Key
    // 2. For each Key, try the Preferred Model first (if any)
    // 3. Then try the Default Models (Flash Lite, then Flash)
    
    for (let i = 0; i < apiKeys.length; i++) {
        const keyUsage = (data.keys && data.keys[i]) ? data.keys[i] : {};

        // Try preferred if user set one
        if (preferredModel && preferredModel.trim()) {
            const count = keyUsage[preferredModel] || 0;
            if (count < 20) return { key: apiKeys[i], keyIndex: i, model: preferredModel };
        }

        // Try defaults
        for (const m of DEFAULT_MODELS) {
            const count = keyUsage[m] || 0;
            if (count < 20) return { key: apiKeys[i], keyIndex: i, model: m };
        }
    }

    // If all exhausted, return the first one as last resort
    return { key: apiKeys[0], keyIndex: 0, model: preferredModel || DEFAULT_MODELS[0] };
}

function sendAIInfoToRenderer() {
    if (win && !win.isDestroyed()) {
        const usageData = readAIUsage();
        const keyUsage = usageData.keys[currentKeyIndex] || {};
        win.webContents.send("ai-info-update", {
            currentModel: currentModelName,
            usage: keyUsage[currentModelName] || 0,
            keyIndex: currentKeyIndex,
            totalKeys: totalKeysAvailable
        });
    }
}

ipcMain.handle('get-ai-info', () => {
    const usageData = readAIUsage();
    const keyUsage = usageData.keys[currentKeyIndex] || {};
    return {
        currentModel: currentModelName,
        usage: keyUsage[currentModelName] || 0,
        keyIndex: currentKeyIndex,
        totalKeys: totalKeysAvailable
    };
});

// Default env values
const ENV_API_KEY = process.env.GEN_AI_API_KEY; // Can be "key1,key2"
const ENV_MODEL_NAME = process.env.GEN_AI_MODEL || "gemini-2.5-flash-lite";

let genAI;
let currentModelName = ENV_MODEL_NAME;
let currentApiKey = null;
let currentKeyIndex = 0;
let totalKeysAvailable = 0;

function initGenAI() {
    const settings = readSettings();
    let apiKeys = [];
    
    // Handle both new array format and legacy string format
    if (Array.isArray(settings.apiKey)) {
        apiKeys = settings.apiKey.map(k => k.trim()).filter(k => k.length > 0);
    } else if (typeof settings.apiKey === 'string' && settings.apiKey.trim()) {
        apiKeys = settings.apiKey.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }

    // Fallback to Env if no settings keys
    if (apiKeys.length === 0 && ENV_API_KEY) {
        apiKeys = ENV_API_KEY.split(',').map(k => k.trim()).filter(k => k.length > 0);
    }

    const preferredModel = (settings.modelName && settings.modelName.trim()) ? settings.modelName.trim() : ENV_MODEL_NAME;
    totalKeysAvailable = apiKeys.length;

    if (apiKeys.length === 0) {
        console.warn("No API Keys found (settings or env). AI features will fail.");
        genAI = null;
        return;
    }

    // Determine the actual model and key based on usage
    const selection = getBestModelAndKey(apiKeys, preferredModel);
    currentApiKey = selection.key;
    currentKeyIndex = selection.keyIndex;
    currentModelName = selection.model;
    
    try {
        genAI = new GoogleGenerativeAI(currentApiKey);
        console.log(`GenAI Initialized with Key #${currentKeyIndex} and model: ${currentModelName}`);
        sendAIInfoToRenderer();
    } catch (error) {
        console.error("Failed to initialize Google Generative AI:", error);
        genAI = null;
    }
}

// Initialize on start will happen when app is ready

const firebaseConfig = {
  apiKey: "AIzaSyAvKsK4Qot2xLzzuVO4bOaTJEKR6kUDlDE",
  authDomain: "woodlsvoice.firebaseapp.com",
  projectId: "woodlsvoice",
  storageBucket: "woodlsvoice.firebasestorage.app",
  messagingSenderId: "23072437848",
  appId: "1:23072437848:web:4af878d59838d4e4863c2d",
  measurementId: "G-GXX6NC69LL"
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);



const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json"); // Legacy, not used
const HISTORY_FILE = path.join(app.getPath("userData"), "history.json"); // Legacy, not used
const GLOBAL_SETTINGS_FILE = path.join(app.getPath("userData"), "global_settings.json"); // App-wide settings
const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");


// Ensure directories exist
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}


let keyboard;
let requiredKeys = []; // single-key expected (array but we use index 0)
let running = false;
let pressStart = null;

let tray = null;
let isQuitting = false;
let server = null; // Store server reference for cleanup

// ----------------- Single Instance Lock -----------------
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running, quit this one immediately
  app.quit();
  process.exit(0); // Force exit to prevent further execution
} else {
  // Handle second instance attempt - focus the existing window
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // Someone tried to run a second instance, we should focus our window.
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
}

// ----------------- helpers -----------------
function readSettings() {
  try {
    const p = getUserPaths().settings;
    if (!fs.existsSync(p)) return { hotkey: [] };
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { hotkey: [] };
  }
}

function saveSettings(newSettings) {
  try {
    const current = readSettings();
    const updated = { ...current, ...newSettings };
    const p = getUserPaths().settings;
    fs.writeFileSync(p, JSON.stringify(updated, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// Global settings (app-wide, not user-specific)
function readGlobalSettings() {
  try {
    if (!fs.existsSync(GLOBAL_SETTINGS_FILE)) return {};
    const raw = fs.readFileSync(GLOBAL_SETTINGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return {};
  }
}

function saveGlobalSettings(newSettings) {
  try {
    const current = readGlobalSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(GLOBAL_SETTINGS_FILE, JSON.stringify(updated, null, 2));
  } catch (e) {
    console.error("Failed to save global settings:", e);
  }
}


// Data Isolation State
let currentUser = null; // { uid, email, displayName, photoURL }

// Helper to reload settings when user changes
function onUserChanged() {
    initGenAI(); // Reload with current user's settings
    const settings = readSettings();
    requiredKeys = Array.isArray(settings.hotkey) ? settings.hotkey : [];
    if (win && !win.isDestroyed()) {
        win.webContents.send("settings-loaded", settings);
        win.webContents.send("hotkey-loaded", requiredKeys);
    }
}

function getUserPaths() {
    const suffix = currentUser ? `_${currentUser.uid}` : "_guest";
    return {
        history: path.join(app.getPath("userData"), `history${suffix}.json`),
        notes: path.join(app.getPath("userData"), `notes${suffix}.json`),
        settings: path.join(app.getPath("userData"), `settings${suffix}.json`)
    };
}

function readHistory() {
  try {
    const p = getUserPaths().history;
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveHistory(history) {
  try {
    const p = getUserPaths().history;
    fs.writeFileSync(p, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error("Failed to save history:", e);
  }
}

function readNotes() {
    try {
        const p = getUserPaths().notes;
        if (!fs.existsSync(p)) return [];
        const raw = fs.readFileSync(p, "utf8");
        return JSON.parse(raw);
    } catch (e) {
        return [];
    }
}

function saveNotes(notes) {
    try {
        const p = getUserPaths().notes;
        fs.writeFileSync(p, JSON.stringify(notes, null, 2));
    } catch (e) {
        console.error("Failed to save notes:", e);
    }
}

// Normalize key names to a stable canonical form.
function normalizeKeyName(raw) {
  if (!raw) return "";
  return String(raw).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

let overlayWin;

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    icon: getAssetPath("webp", "woodls.png"),
    frame: false, // Custom title bar
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false, // Keep running in background
    },
    show: false, // Don't show initially, we'll decide later
  });

  // Check if we should start hidden
  const hasHiddenArg = process.argv.includes('--hidden') || process.argv.includes('--start-hidden');
  const globalSettings = readGlobalSettings();
  const startHidden = hasHiddenArg || globalSettings.startHidden;
  
  if (!startHidden) {
      win.show();
  }

  // Tray Setup
  const iconPath = getAssetPath("webp", "woodls.png"); // Use woodls icon
  // better to use a dedicated icon but user has webp files. 
  // Let's try to load one. If not, maybe just use empty string which might fail or show generic.
  // We'll use the one from webp folder for now.
  try {
      // Resize to 32x32 for better visibility on high DPI, or let OS handle it if we remove resize?
      // Windows standard is 16x16 small, 32x32 large. Let's try 32 for "bigger".
      const icon = nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 });
      tray = new Tray(icon);
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Open Woodls', click: () => win.show() },
        { type: 'separator' },
        { label: 'Quit', click: () => {
            isQuitting = true;
            app.quit();
        }}
      ]);
      tray.setToolTip('Woodls');
      tray.setContextMenu(contextMenu);
      
      tray.on('click', () => {
          if (win.isVisible()) {
              win.hide();
          } else {
              win.show();
          }
      });
  } catch (e) {
      console.error("Tray error:", e);
  }

  win.on('close', (event) => {
      if (!isQuitting) {
          event.preventDefault();
          win.hide();
          return false;
      }
  });

  // Window Controls IPC
  ipcMain.on("window-minimize", () => win.minimize());
  ipcMain.on("window-maximize", () => {
    if (win.isMaximized()) {
      win.unmaximize();
    } else {
      win.maximize();
    }
  });
  ipcMain.on("window-close", () => win.close());

  // Auth IPC
  ipcMain.handle("auth-login", async (_, { email, password }) => {
      try {
          const cred = await signInWithEmailAndPassword(auth, email, password);
          currentUser = { 
              uid: cred.user.uid, 
              email: cred.user.email, 
              displayName: cred.user.displayName,
              photoURL: cred.user.photoURL
          };
          // Reload settings for this user
          onUserChanged();
          // Notify renderer of state change
          win.webContents.send("auth-state-changed", currentUser);
          return { success: true, user: currentUser };
      } catch (e) {
          return { success: false, error: e.message };
      }
  });

  ipcMain.handle("auth-signup", async (_, { email, password, name }) => {
      try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          if (name) await updateProfile(cred.user, { displayName: name });
          
          currentUser = { 
              uid: cred.user.uid, 
              email: cred.user.email, 
              displayName: name,
              photoURL: null
          };
          // Reload settings for this user
          onUserChanged();
          win.webContents.send("auth-state-changed", currentUser);
          return { success: true, user: currentUser };
      } catch (e) {
          return { success: false, error: e.message };
      }
  });

  ipcMain.handle("auth-sync-user", async (_, user) => {
      // Generic Sync from Renderer (Google OR Email)
      if (user) {
          currentUser = {
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
        };
      } else {
          currentUser = null;
      }
      // Reload settings for this user
      onUserChanged();
      // Notify other windows if needed (e.g. overlay)
      // We do NOT need to send auth-state-changed back to main window since it initiated this.
      return { success: true };
  });

  ipcMain.handle("auth-logout", async () => {
      try {
          await signOut(auth); // Sign out of Main process auth if any
          currentUser = null;
          // Reload settings for guest user
          onUserChanged();
           win.webContents.send("auth-state-changed", null);
          return { success: true };
      } catch (e) {
          return { success: false, error: e.message };
      }
  });

  ipcMain.handle("auth-get-current", () => {
      // Return our manual state which covers both flows
      return currentUser;
  });

  // Handle external links for new windows
  win.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Google/Firebase Auth flows to open as child windows
    if (url.includes('accounts.google.com') || url.includes('firebaseapp.com') || url.includes('/auth/handler')) {
        return { action: 'allow' };
    }
    
    // Open other links in default browser
    if (url.startsWith('http')) {
        require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Start Local Server to avoid file:// protocol issues with Firebase Auth
  const http = require('http');
  server = http.createServer((req, res) => {
    // Basic static file server
    const fs = require('fs');
    const path = require('path');
    
    let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url);
    
    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
    }

    const extname = path.extname(filePath);
    let contentType = 'text/html';
    switch (extname) {
        case '.js': contentType = 'text/javascript'; break;
        case '.css': contentType = 'text/css'; break;
        case '.json': contentType = 'application/json'; break;
        case '.png': contentType = 'image/png'; break;
        case '.jpg': contentType = 'image/jpg'; break;
        case '.webp': contentType = 'image/webp'; break;
    }

    fs.readFile(filePath, (error, content) => {
        if (error) {
            if(error.code == 'ENOENT'){
                // Try index.html or 404
                res.writeHead(404);
                res.end('Not Found');
            } else {
                res.writeHead(500);
                res.end('Sorry, check with the site admin for error: '+error.code+' ..\n');
            }
        } else {
            res.writeHead(200, { 'Content-Type': contentType });
            res.end(content, 'utf-8');
        }
    });
  });
  
  const PORT = 3456;
  
  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} in use, trying another...`);
      setTimeout(() => {
        server.listen(0, 'localhost'); // Listen on any available port
      }, 1000);
    } else {
      console.error("Local server error:", e);
    }
  });

  server.listen(PORT, 'localhost', () => {
     const port = server.address().port;
     console.log(`Server running at http://localhost:${port}/`);
     if (win && !win.isDestroyed()) {
         win.loadURL(`http://localhost:${port}/index.html`);
     }
  });

  // win.loadFile(indexPath).catch(e => console.error("Failed to load index.html:", e));

  const settings = readSettings();
  requiredKeys = Array.isArray(settings.hotkey) ? settings.hotkey : [];

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("hotkey-loaded", requiredKeys);
    win.webContents.send("settings-loaded", settings);
  });
  
  // Close overlay when main window closes
  win.on('closed', () => {
    if (overlayWin) overlayWin.destroy();
    win = null;
  });

  createOverlayWindow();

  setupGlobalKeyboard();
  startActiveWindowMonitor();

  // Auth State Listener
  onAuthStateChanged(auth, (user) => {
    if (win && !win.isDestroyed()) {
        // Update currentUser for Firebase auth flow
        if (user) {
            currentUser = { 
                uid: user.uid, 
                email: user.email, 
                displayName: user.displayName,
                photoURL: user.photoURL
            };
        } else {
            currentUser = null;
        }
        // Reload settings for this user
        onUserChanged();
        win.webContents.send("auth-state-changed", user ? { 
            uid: user.uid, 
            email: user.email, 
            displayName: user.displayName 
        } : null);
    }
  });
}

function createOverlayWindow() {
  const { width, height } = require("electron").screen.getPrimaryDisplay().workAreaSize;
  
  // Pill size (Smaller & Narrower)
  const w = 100;
  const h = 40;
  const x = Math.round((width - w) / 2);
  const y = height - h - 10; // 10px from bottom

  overlayWin = new BrowserWindow({
    width: w,
    height: h,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false, // hidden by default
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, 
    },
    focusable: false, 
    hasShadow: false,
    type: "toolbar", // Helps with staying on top on Windows
  });
  
  overlayWin.setIgnoreMouseEvents(true);
  overlayWin.loadFile("overlay.html");
  overlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

// ----------------- Active Window Monitor -----------------
function startActiveWindowMonitor() {
  setInterval(async () => {
    try {
      if (!activeWin) return; // Guard against uninitialized ESM module
      const info = await activeWin();
      if (win && !win.isDestroyed()) win.webContents.send("active-window", info);
    } catch (e) {
      // ignore
    }
  }, 1000);
}

// ----------------- Overlay IPC -----------------
ipcMain.on('show-overlay', () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
      // Center on screen or specific position? 
      // For now, let's just show it. Default center is fine for the small 200x200 window.
      overlayWin.showInactive();
      overlayWin.setAlwaysOnTop(true, "screen-saver");
  }
});

ipcMain.on('hide-overlay', () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.hide();
  }
});

ipcMain.on('mic-volume', (event, volume) => {
    if (overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.webContents.send('mic-volume', volume);
    }
});

// ----------------- global keyboard listener -----------------
function setupGlobalKeyboard() {
  if (keyboard) return;
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener((event) => {
    // event: { state: "DOWN"|"UP", name: "A"|"NUMPAD8"|... }
    const rawName = event && event.name ? String(event.name) : "";
    const key = normalizeKeyName(rawName); // e.g. NUMPAD8 -> "NUMPAD8"
    const HOTKEY = (requiredKeys && requiredKeys[0]) ? normalizeKeyName(requiredKeys[0]) : null;

    if (!HOTKEY) return;

    if (event.state === "DOWN" && key === HOTKEY && !running) {
      running = true;
      pressStart = Date.now();
      win.webContents.send("record-start");
      win.webContents.send("hotkey-pressed", { key: HOTKEY, time: pressStart });
    }

    if (event.state === "UP" && key === HOTKEY && running) {
      running = false;
      const releaseTime = Date.now();
      const duration = releaseTime - (pressStart || releaseTime);
      pressStart = null;
      win.webContents.send("record-stop");
      win.webContents.send("hotkey-released", { key: HOTKEY, releaseTime, duration });
    }
  });
}

// ----------------- IPC: Hotkey management -----------------
// ----------------- IPC: Hotkey & Settings management -----------------
ipcMain.on("save-hotkey", (event, keys) => {
  const normalized = (keys || []).map(k => normalizeKeyName(k));
  requiredKeys = normalized;
  saveSettings({ hotkey: normalized });
  event.reply("hotkey-saved", normalized);
});

ipcMain.on("clear-hotkey", (event) => {
  requiredKeys = [];
  saveSettings({ hotkey: [] });
  event.reply("hotkey-cleared");
});

ipcMain.on("save-setting", (event, { key, value }) => {
    saveSettings({ [key]: value });
    // Re-init AI if relevant settings change
    if (key === 'apiKey' || key === 'modelName') {
        initGenAI();
    }
});

ipcMain.on("set-startup-settings", (event, { openAtLogin, startHidden }) => {
    app.setLoginItemSettings({
        openAtLogin: openAtLogin,
        path: app.getPath('exe'),
        args: startHidden ? ['--hidden'] : []
    });
    // Save to global settings so it persists before user login
    saveGlobalSettings({ openAtLogin, startHidden });
});

ipcMain.on("get-startup-settings", (event) => {
    const { openAtLogin } = app.getLoginItemSettings();
    // Read from global settings for UI state
    const globalSettings = readGlobalSettings();
    event.reply("startup-settings-loaded", { 
        openAtLogin: globalSettings.openAtLogin !== undefined ? globalSettings.openAtLogin : openAtLogin,
        startHidden: globalSettings.startHidden || false 
    });
});

ipcMain.on("get-hotkey", (event) => {
  event.reply("hotkey-loaded", requiredKeys);
});



// ----------------- IPC: Save recorded audio -----------------
ipcMain.on("save-audio", async (event, arrayBuffer) => {
  try {
    const { filePath } = await dialog.showSaveDialog({
      title: "Save Recording",
      defaultPath: "recording.webm",
      filters: [{ name: "WebM Audio", extensions: ["webm"] }, { name: "All Files", extensions: ["*"] }],
    });

    if (!filePath) {
      event.reply("save-complete", null);
      return;
    }

    // arrayBuffer may arrive as an object; convert to Buffer
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(filePath, buffer);
    event.reply("save-complete", filePath);
  } catch (err) {
    console.error("Failed to save audio:", err);
    event.reply("save-complete", null);
  }
});


ipcMain.on("processing-start", () => {
  if (overlayWin) overlayWin.webContents.send("processing-start");
});
ipcMain.on("processing-end", () => {
  if (overlayWin) overlayWin.webContents.send("processing-end");
});


// ----------------- Auto Type / Input --------------------------
ipcMain.handle("auto-type", async (_, text) => {
  try {
    if (!text || typeof text !== "string") return "No text";
    await new Promise(res => setTimeout(res, 50)); // ensure focus
    robot.typeString(text);
    return "typed";
  } catch (e) {
    return "error";
  }
});

ipcMain.handle("send-backspace", async () => {
    try {
        robot.keyTap("backspace");
        return true;
    } catch(e) { return false; }
});

ipcMain.handle("paste-string", async (_, text) => {
    try {
        const { clipboard } = require("electron");
        clipboard.writeText(text);
        await new Promise(res => setTimeout(res, 50));
        // Ctrl+V or Cmd+V
        const mod = process.platform === "darwin" ? "command" : "control";
        robot.keyTap("v", mod);
        return true;
    } catch(e) { return false; }
});

// ----------------- IPC: History -----------------
ipcMain.handle("get-history", () => {
  return readHistory().reverse(); // Show newest first
});

ipcMain.handle("delete-history-item", (_, id) => {
    let history = readHistory();
    const item = history.find(i => i.id === id);
    if (item && item.audioPath && fs.existsSync(item.audioPath)) {
        try {
            fs.unlinkSync(item.audioPath);
        } catch(e) { console.error("Failed to delete audio file", e); }
    }
    history = history.filter(i => i.id !== id);
    saveHistory(history);
    return true;
});

ipcMain.handle("read-audio-file", (_, p) => {
    try {
        if (fs.existsSync(p)) {
            const buffer = fs.readFileSync(p);
            return buffer.toString("base64");
        }
    } catch(e) {}
    return null;
});

// ----------------- IPC: Notes -----------------
ipcMain.handle("get-notes", () => {
    return readNotes().reverse();
});

ipcMain.handle("save-note", (_, note) => {
    // note: { id (optional), title, content, color, pin }
    let notes = readNotes();
    if (note.id) {
        const idx = notes.findIndex(n => n.id === note.id);
        if (idx >= 0) {
            notes[idx] = { ...notes[idx], ...note, timestamp: Date.now() };
        } else {
            notes.push({ ...note, timestamp: Date.now() });
        }
    } else {
        const newNote = {
            id: Date.now().toString(),
            timestamp: Date.now(),
            ...note
        };
        notes.push(newNote);
    }
    saveNotes(notes);
    return true;
});

ipcMain.handle("delete-note", (_, id) => {
    let notes = readNotes();
    notes = notes.filter(n => n.id !== id);
    saveNotes(notes);
    return true;
});



// ----------------- IPC: speech to text -----------------

ipcMain.handle("transcribe-audio", async (_, arrayBuffer) => {
  const maxRetries = 3; // Allow more retries for multi-key
  let attempt = 0;
  let savePath;

  while (attempt < maxRetries) {
    try {
      if (!genAI) throw new Error("AI not initialized. Check API Key.");
      
      const settings = readSettings();
      // fileManager needs a valid key. Use currentApiKey.
      const fileManager = new GoogleAIFileManager(currentApiKey);

      // 1. Save to recordings folder for history (only once)
      if (attempt === 0) {
        savePath = path.join(RECORDINGS_DIR, `rec_${Date.now()}.webm`);
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(savePath, buffer);
      }

      // upload the audio
      const upload = await fileManager.uploadFile(savePath, {
        mimeType: "audio/webm",
        displayName: "hotkey-recording",
      });

      // now transcribe
      const model = genAI.getGenerativeModel({ model: currentModelName });

      const result = await model.generateContent([
        "Transcribe this audio to plain text only: ",
        {
          fileData: {
            mimeType: upload.file.mimeType,
            fileUri: upload.file.uri,
          }
        }
      ]);

      const text = result.response.text();
      
      // SUCCESS: Update usage for this specific Key + Model
      updateAIUsage(currentKeyIndex, currentModelName);

      const historyItem = {
          id: Date.now().toString(),
          timestamp: Date.now(),
          text: text, // Raw transcript
          audioPath: savePath
      };
      
      const history = readHistory();
      history.push(historyItem);
      saveHistory(history);

      return text;
    } catch (err) {
      console.error(`Transcription error (Attempt ${attempt + 1}/${maxRetries}):`, err);
      
      const isRateLimit = err && (err.status === 429 || (err.message && err.message.includes("quota")));
      
      if (isRateLimit && attempt < maxRetries - 1) {
          console.warn(`[AI] Rate limit hit for Key #${currentKeyIndex} (${currentModelName}). Rotating...`);
          // Mark this pair as exhausted
          const usageData = readAIUsage();
          if (!usageData.keys[currentKeyIndex]) usageData.keys[currentKeyIndex] = {};
          usageData.keys[currentKeyIndex][currentModelName] = 20;
          saveAIUsage(usageData);
          
          // Re-init with next best key/model pair
          initGenAI();
          attempt++;
          continue;
      }
      
      return "Error: " + err.message;
    }
  }
});


// ----------------- IPC: LLM generation (placeholder) -----------------
ipcMain.handle("generate-text", async (_, { info, assistantName, appName }) => {
  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    const prompt = `
You are my AI assistant.
Your job is to rewrite the given input text with proper punctuation, grammar, formatting, and clarity.  
Rewrite it as if I am describing something to you, and you are returning a refined version of what I should write.  
Return **only the refined text**, no explanations, no quotes, no markdown unless necessary.
**CRITICAL**: Do NOT include timestamps (e.g. (00:00), 01:23) or any video tracking metadata. Filter them out completely.

App: ${appName}
Text: "${info}"
`;
    try {
      if (!genAI) throw new Error("AI not initialized.");
      const model = genAI.getGenerativeModel({ model: currentModelName });
      const result = await model.generateContent(prompt);
      let txt = result.response.text();
      
      // SUCCESS: Update usage for this specific Key + Model
      updateAIUsage(currentKeyIndex, currentModelName);

      // Extra safety cleanup for hallucinations
      txt = txt.replace(/\(\d{2}:\d{2}\)/g, "").trim(); 
      return txt;
    } catch (err) {
      console.error(`Generation error (Attempt ${attempt + 1}/${maxRetries}):`, err);
      
      const isRateLimit = err && (err.status === 429 || (err.message && err.message.includes("quota")));
      
      if (isRateLimit && attempt < maxRetries - 1) {
          console.warn(`[AI] Rate limit hit for Key #${currentKeyIndex} (${currentModelName}). Rotating...`);
          // Mark as exhausted
          const usageData = readAIUsage();
          if (!usageData.keys[currentKeyIndex]) usageData.keys[currentKeyIndex] = {};
          usageData.keys[currentKeyIndex][currentModelName] = 20;
          saveAIUsage(usageData);
          
          // Re-init with next best key/model pair
          initGenAI();
          attempt++;
          continue;
      }
      
      return "Error: " + (err && err.message ? err.message : String(err));
    }
  }
});

// ----------------- app lifecycle -----------------
app.whenReady().then(() => {
    initGenAI();
    createWindow();
});

app.on("window-all-closed", (e) => {
  if (!isQuitting) e.preventDefault();
});

app.on('before-quit', () => {
    isQuitting = true;
    // Close the HTTP server to prevent port lingering
    if (server) {
        server.close(() => {
            console.log('Server closed');
        });
    }
});

app.on('activate', () => {
    if (win === null) {
        createWindow();
    } else {
        win.show();
    }
});

