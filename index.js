// main.js
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
} = require("electron");
const { autoUpdater } = require("electron-updater");
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
const {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");

// ---- CONFIG ----
require("dotenv").config();

// Asset Path Helper for Production (app.asar support)
const getAssetPath = (...paths) => {
  return path.join(
    app.isPackaged ? process.resourcesPath : __dirname,
    ...paths,
  );
};

let win; // Moved to top to avoid TDZ issues
// ----------------- AI ROTATION -----------------
const DEFAULT_MODELS = ["gemini-2.5-flash-lite", "gemini-2.5-flash"];
const MAX_DAILY_CALLS = 20;
const AI_USAGE_FILE = path.join(app.getPath("userData"), "ai_usage.json");

function readAIUsage() {
  try {
    const today = new Date().toISOString().split("T")[0];
    if (!fs.existsSync(AI_USAGE_FILE)) return { date: today, keys: {} };
    const raw = fs.readFileSync(AI_USAGE_FILE, "utf8");
    const data = JSON.parse(raw);
    if (data.date !== today || !data.keys) {
      return { date: today, keys: {} };
    }
    return data; // { date, keys: { "0": { "model": count } } } yes
  } catch (e) {
    return { date: new Date().toISOString().split("T")[0], keys: {} };
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
  console.log(
    `[AI] Usage updated for Key #${keyIndex} (${modelName}): ${data.keys[keyIndex][modelName]} calls today`,
  );
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
    const keyUsage = data.keys && data.keys[i] ? data.keys[i] : {};

    // Try preferred if user set one
    if (preferredModel && preferredModel.trim()) {
      const count = keyUsage[preferredModel] || 0;
      if (count < MAX_DAILY_CALLS)
        return { key: apiKeys[i], keyIndex: i, model: preferredModel };
    }

    // Try defaults
    for (const m of DEFAULT_MODELS) {
      const count = keyUsage[m] || 0;
      if (count < MAX_DAILY_CALLS)
        return { key: apiKeys[i], keyIndex: i, model: m };
    }
  }

  // If all exhausted, return the first one as last resort
  return {
    key: apiKeys[0],
    keyIndex: 0,
    model: preferredModel || DEFAULT_MODELS[0],
  };
}

function sendAIInfoToRenderer() {
  if (win && !win.isDestroyed()) {
    const usageData = readAIUsage();
    const keyUsage = usageData.keys[currentKeyIndex] || {};
    win.webContents.send("ai-info-update", {
      currentModel: currentModelName,
      usage: keyUsage[currentModelName] || 0,
      keyIndex: currentKeyIndex,
      totalKeys: totalKeysAvailable,
    });
  }
}

ipcMain.handle("get-ai-info", () => {
  const usageData = readAIUsage();
  const keyUsage = usageData.keys[currentKeyIndex] || {};
  return {
    currentModel: currentModelName,
    usage: keyUsage[currentModelName] || 0,
    keyIndex: currentKeyIndex,
    totalKeys: totalKeysAvailable,
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
    apiKeys = settings.apiKey.map((k) => k.trim()).filter((k) => k.length > 0);
  } else if (typeof settings.apiKey === "string" && settings.apiKey.trim()) {
    apiKeys = settings.apiKey
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  // Fallback to Env if no settings keys
  if (apiKeys.length === 0 && ENV_API_KEY) {
    apiKeys = ENV_API_KEY.split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  const preferredModel =
    settings.modelName && settings.modelName.trim()
      ? settings.modelName.trim()
      : ENV_MODEL_NAME;
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
    console.log(
      `GenAI Initialized with Key #${currentKeyIndex} and model: ${currentModelName}`,
    );
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
  measurementId: "G-GXX6NC69LL",
};

const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json"); // Legacy, not used
const HISTORY_FILE = path.join(app.getPath("userData"), "history.json"); // Legacy, not used
const GLOBAL_SETTINGS_FILE = path.join(
  app.getPath("userData"),
  "global_settings.json",
); // App-wide settings
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
  app.on("second-instance", (event, commandLine, workingDirectory) => {
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
    settings: path.join(app.getPath("userData"), `settings${suffix}.json`),
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
  return String(raw)
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();
}

let overlayWin;

let lastDuration = 0;

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
  const hasHiddenArg =
    process.argv.includes("--hidden") ||
    process.argv.includes("--start-hidden");
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
    const icon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 32, height: 32 });
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: "Open Woodls", click: () => win.show() },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          isQuitting = true;
          app.quit();
        },
      },
    ]);
    tray.setToolTip("Woodls");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (win.isVisible()) {
        win.hide();
      } else {
        win.show();
      }
    });
  } catch (e) {
    console.error("Tray error:", e);
  }

  win.on("close", (event) => {
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

  ipcMain.on("restart-app", () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

  ipcMain.on("test-update-ui", () => {
    createUpdatePromptWindow();
  });

  // Auth IPC
  ipcMain.handle("auth-login", async (_, { email, password }) => {
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      currentUser = {
        uid: cred.user.uid,
        email: cred.user.email,
        displayName: cred.user.displayName,
        photoURL: cred.user.photoURL,
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
        photoURL: null,
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
        photoURL: user.photoURL,
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
    if (
      url.includes("accounts.google.com") ||
      url.includes("firebaseapp.com") ||
      url.includes("/auth/handler")
    ) {
      return { action: "allow" };
    }

    // Open other links in default browser
    if (url.startsWith("http")) {
      require("electron").shell.openExternal(url);
    }
    return { action: "deny" };
  });

  // Start Local Server to avoid file:// protocol issues with Firebase Auth
  const http = require("http");
  server = http.createServer((req, res) => {
    // Basic static file server
    const fs = require("fs");
    const path = require("path");

    let filePath = path.join(
      __dirname,
      req.url === "/" ? "index.html" : req.url,
    );

    // Prevent directory traversal
    if (!filePath.startsWith(__dirname)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const extname = path.extname(filePath);
    let contentType = "text/html";
    switch (extname) {
      case ".js":
        contentType = "text/javascript";
        break;
      case ".css":
        contentType = "text/css";
        break;
      case ".json":
        contentType = "application/json";
        break;
      case ".png":
        contentType = "image/png";
        break;
      case ".jpg":
        contentType = "image/jpg";
        break;
      case ".webp":
        contentType = "image/webp";
        break;
    }

    fs.readFile(filePath, (error, content) => {
      if (error) {
        if (error.code == "ENOENT") {
          // Try index.html or 404
          res.writeHead(404);
          res.end("Not Found");
        } else {
          res.writeHead(500);
          res.end(
            "Sorry, check with the site admin for error: " +
              error.code +
              " ..\n",
          );
        }
      } else {
        res.writeHead(200, { "Content-Type": contentType });
        res.end(content, "utf-8");
      }
    });
  });

  const PORT = 3456;

  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      console.warn(`Port ${PORT} in use, trying another...`);
      setTimeout(() => {
        server.listen(0, "localhost"); // Listen on any available port
      }, 1000);
    } else {
      console.error("Local server error:", e);
    }
  });

  server.listen(PORT, "localhost", () => {
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
    sendAIInfoToRenderer();
  });

  // Close overlay when main window closes
  win.on("closed", () => {
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
          photoURL: user.photoURL,
        };
      } else {
        currentUser = null;
      }
      // Reload settings for this user
      onUserChanged();
      win.webContents.send(
        "auth-state-changed",
        user
          ? {
              uid: user.uid,
              email: user.email,
              displayName: user.displayName,
            }
          : null,
      );
    }
  });
}

function createOverlayWindow() {
  const { width, height } =
    require("electron").screen.getPrimaryDisplay().workAreaSize;

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

function createUpdatePromptWindow() {
  const updatePromptWin = new BrowserWindow({
    width: 450,
    height: 350,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  updatePromptWin.loadFile("update_prompt.html");
  updatePromptWin.center();
}

// ----------------- Active Window Monitor -----------------
function startActiveWindowMonitor() {
  setInterval(async () => {
    try {
      if (!activeWin) return; // Guard against uninitialized ESM module
      const info = await activeWin();
      if (win && !win.isDestroyed())
        win.webContents.send("active-window", info);
    } catch (e) {
      // ignore
    }
  }, 1000);
}

// ----------------- Overlay IPC -----------------
ipcMain.on("show-overlay", (event, aiEnabled) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, "screen-saver");
    overlayWin.webContents.send("set-ai-status", !!aiEnabled);
  }
});

ipcMain.on("hide-overlay", () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.hide();
  }
});

ipcMain.on("mic-volume", (event, volume) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("mic-volume", volume);
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
    const HOTKEY =
      requiredKeys && requiredKeys[0]
        ? normalizeKeyName(requiredKeys[0])
        : null;

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
      lastDuration = duration;
      pressStart = null;
      win.webContents.send("record-stop");
      win.webContents.send("hotkey-released", {
        key: HOTKEY,
        releaseTime,
        duration,
      });
    }
  });
}

// ----------------- IPC: Hotkey management -----------------
// ----------------- IPC: Hotkey & Settings management -----------------
ipcMain.on("save-hotkey", (event, keys) => {
  const normalized = (keys || []).map((k) => normalizeKeyName(k));
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
  if (key === "apiKey" || key === "modelName") {
    initGenAI();
  }
});

ipcMain.on("set-startup-settings", (event, { openAtLogin, startHidden }) => {
  app.setLoginItemSettings({
    openAtLogin: openAtLogin,
    path: app.getPath("exe"),
    args: startHidden ? ["--hidden"] : [],
  });
  // Save to global settings so it persists before user login
  saveGlobalSettings({ openAtLogin, startHidden });
});

ipcMain.on("get-startup-settings", (event) => {
  const { openAtLogin } = app.getLoginItemSettings();
  // Read from global settings for UI state
  const globalSettings = readGlobalSettings();
  event.reply("startup-settings-loaded", {
    openAtLogin:
      globalSettings.openAtLogin !== undefined
        ? globalSettings.openAtLogin
        : openAtLogin,
    startHidden: globalSettings.startHidden || false,
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
      filters: [
        { name: "WebM Audio", extensions: ["webm"] },
        { name: "All Files", extensions: ["*"] },
      ],
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
    await new Promise((res) => setTimeout(res, 50)); // ensure focus
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
  } catch (e) {
    return false;
  }
});

ipcMain.handle("paste-string", async (_, text) => {
  try {
    const { clipboard } = require("electron");
    clipboard.writeText(text);
    await new Promise((res) => setTimeout(res, 50));
    // Ctrl+V or Cmd+V
    const mod = process.platform === "darwin" ? "command" : "control";
    robot.keyTap("v", mod);
    return true;
  } catch (e) {
    return false;
  }
});

// ----------------- IPC: History -----------------
ipcMain.handle("get-history", () => {
  return readHistory().reverse(); // Show newest first
});

ipcMain.handle("delete-history-item", (_, id) => {
  let history = readHistory();
  const item = history.find((i) => i.id === id);
  if (item && item.audioPath && fs.existsSync(item.audioPath)) {
    try {
      fs.unlinkSync(item.audioPath);
    } catch (e) {
      console.error("Failed to delete audio file", e);
    }
  }
  history = history.filter((i) => i.id !== id);
  saveHistory(history);
  return true;
});

ipcMain.handle("update-history-item", (_, { id, text, isAI }) => {
  let history = readHistory();
  const idx = history.findIndex((i) => i.id === id);
  if (idx >= 0) {
    history[idx].text = text;
    if (isAI !== undefined) history[idx].isAI = isAI;
    saveHistory(history);
    return true;
  }
  return false;
});

ipcMain.handle("read-audio-file", (_, p) => {
  try {
    if (fs.existsSync(p)) {
      const buffer = fs.readFileSync(p);
      return buffer.toString("base64");
    }
  } catch (e) {}
  return null;
});

ipcMain.handle("get-stats", () => {
  const history = readHistory();
  let totalWords = 0;
  let totalDurationMs = 0;

  history.forEach((item) => {
    // Word count
    if (item.text) {
      const words = item.text.trim().split(/\s+/).length;
      totalWords += words;

      // Duration
      if (item.duration) {
        totalDurationMs += item.duration;
      } else {
        // Estimate for legacy items: 150 WPM = 2.5 words per second
        totalDurationMs += (words / 2.5) * 1000;
      }
    }
  });

  const totalMinutes = totalDurationMs / 60000;
  // Time saved: Assuming typing is 40 WPM
  const timeSavedMinutes = Math.max(0, totalWords / 40 - totalMinutes);
  const averageWPM = totalMinutes > 0 ? totalWords / totalMinutes : 0;

  return {
    totalWords,
    totalDurationMs,
    timeSavedMinutes,
    averageWPM,
  };
});

// ----------------- IPC: Notes -----------------
ipcMain.handle("get-notes", () => {
  return readNotes().reverse();
});

ipcMain.handle("save-note", (_, note) => {
  // note: { id (optional), title, content, color, pin }
  let notes = readNotes();
  if (note.id) {
    const idx = notes.findIndex((n) => n.id === note.id);
    if (idx >= 0) {
      notes[idx] = { ...notes[idx], ...note, timestamp: Date.now() };
    } else {
      notes.push({ ...note, timestamp: Date.now() });
    }
  } else {
    const newNote = {
      id: Date.now().toString(),
      timestamp: Date.now(),
      ...note,
    };
    notes.push(newNote);
  }
  saveNotes(notes);
  return true;
});

ipcMain.handle("delete-note", (_, id) => {
  let notes = readNotes();
  notes = notes.filter((n) => n.id !== id);
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
          },
        },
      ]);

      const text = result.response.text();

      // SUCCESS: Update usage for this specific Key + Model
      updateAIUsage(currentKeyIndex, currentModelName);

      const historyItem = {
        id: Date.now().toString(),
        timestamp: Date.now(),
        text: text, // Raw transcript
        audioPath: savePath,
        duration: lastDuration,
      };

      // Reset lastDuration to avoid reuse
      lastDuration = 0;

      const history = readHistory();
      history.push(historyItem);
      saveHistory(history);

      return { text: text, id: historyItem.id };
    } catch (err) {
      console.error(
        `Transcription error (Attempt ${attempt + 1}/${maxRetries}):`,
        err,
      );

      if (attempt < maxRetries - 1) {
        console.warn(
          `[AI] Error encountered. Rotating key/model for robust retry...`,
        );
        // Mark this pair as exhausted for the current session to force rotation
        const usageData = readAIUsage();
        if (!usageData.keys[currentKeyIndex])
          usageData.keys[currentKeyIndex] = {};
        // Temporarily set to max to push rotation
        usageData.keys[currentKeyIndex][currentModelName] = MAX_DAILY_CALLS;
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

ipcMain.handle("retranscribe-audio", async (_, id) => {
  const history = readHistory();
  const item = history.find((i) => i.id === id);
  if (!item || !item.audioPath || !fs.existsSync(item.audioPath)) {
    return "Error: File not found";
  }

  const maxRetries = 3;
  let attempt = 0;

  while (attempt < maxRetries) {
    try {
      if (!genAI) throw new Error("AI not initialized.");
      const fileManager = new GoogleAIFileManager(currentApiKey);
      const upload = await fileManager.uploadFile(item.audioPath, {
        mimeType: "audio/webm",
        displayName: "retranscription",
      });

      const model = genAI.getGenerativeModel({ model: currentModelName });
      const result = await model.generateContent([
        "Transcribe this audio to plain text only: ",
        {
          fileData: {
            mimeType: upload.file.mimeType,
            fileUri: upload.file.uri,
          },
        },
      ]);

      const text = result.response.text();
      updateAIUsage(currentKeyIndex, currentModelName);

      // Update history item
      const historyUpdate = readHistory();
      const idx = historyUpdate.findIndex((i) => i.id === id);
      if (idx >= 0) {
        historyUpdate[idx].text = text;
        saveHistory(historyUpdate);
      }

      return text;
    } catch (err) {
      console.error(`Retranscription error:`, err);
      if (attempt < maxRetries - 1) {
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
You are a versatile AI Assistant. 
Your primary goal is to help me with the task I dictate or refine the text I provide, tailored to the platform I am currently using.

1. If the input is a specific request or command (e.g., "write an email to...", "write a javascript function for..."), execute that task as requested.
2. If the input is just conversational or descriptive text, rewrite it with proper punctuation, grammar, formatting, and clarity.
3. **Platform Context**:
   - If the platform is an **Email Client** (e.g., Gmail, Outlook), use formal or professional email formatting (Subject, Salutation) if it seems like a new message.
   - If the platform is **Notion**, **Slack**, or **Discord**, use appropriate formatting (bullet points, bolding) to make the text scannable.
   - If the platform is a **Code Editor** (e.g., VS Code, Cursor), provide clean code blocks or technical descriptions.
4. Return **ONLY the final result**. No conversational filler, no "Here is your text...", no explanations, no quotes. 
5. Use Markdown ONLY if it improves structural clarity (e.g., for code blocks, headers, or bullet points).
6. **CRITICAL**: Do NOT include any timestamps (e.g., (00:00)) or video tracking metadata.

Context:
App: ${appName}
Input: "${info}"
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
      console.error(
        `Generation error (Attempt ${attempt + 1}/${maxRetries}):`,
        err,
      );

      if (attempt < maxRetries - 1) {
        console.warn(`[AI] Error encountered in enhancement. Rotating...`);
        // Mark as exhausted for session
        const usageData = readAIUsage();
        if (!usageData.keys[currentKeyIndex])
          usageData.keys[currentKeyIndex] = {};
        usageData.keys[currentKeyIndex][currentModelName] = MAX_DAILY_CALLS;
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

  // Check for updates after a short delay to ensure windows are ready
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      console.error("[Updater] Initial check failed:", err);
    });
  }, 5000);
});

// Manual Update Check
ipcMain.handle("check-for-updates", async () => {
  console.log("[Updater] Manual check requested");
  try {
    const result = await autoUpdater.checkForUpdates();
    return { success: true, result };
  } catch (err) {
    console.error("[Updater] Manual check failed:", err);
    return { success: false, error: err.message };
  }
});

// Developer email for debug logs
const DEV_EMAIL = "satyamyadav9uv@gmail.com";

// Helper to check if current user is developer
function isDevUser() {
  return currentUser && currentUser.email === DEV_EMAIL;
}

// Helper to send update status to all windows
function sendUpdateStatus(status, details = null) {
  if (win && !win.isDestroyed()) {
    win.webContents.send("update-status", { status, details });
  }
}

// Helper to send debug logs only to developer
function sendDevLog(message) {
  console.log(`[DEV] ${message}`);
  if (isDevUser() && win && !win.isDestroyed()) {
    win.webContents.send("dev-log", message);
  }
}

// Auto-Update Events and Configuration
autoUpdater.autoDownload = true;
autoUpdater.allowPrerelease = false;
autoUpdater.requestHeaders = { "Cache-Control": "no-cache" };

// Set up logger
autoUpdater.logger = {
  info: (msg) => console.log(`[Updater INFO] ${msg}`),
  warn: (msg) => console.warn(`[Updater WARN] ${msg}`),
  error: (msg) => console.error(`[Updater ERROR] ${msg}`),
};

autoUpdater.on("checking-for-update", () => {
  console.log("[Updater] Checking for update...");
  sendDevLog(
    `[Updater] Checking for update... Current version: ${app.getVersion()}`,
  );
  sendDevLog(
    `[Updater] Update URL: https://github.com/SimpleCyber/Woodls/releases/latest/download/latest.yml`,
  );
  sendUpdateStatus("checking");
});

autoUpdater.on("update-available", (info) => {
  console.log("[Updater] Update available:", info.version);
  sendDevLog(`[Updater] ✅ Update FOUND! New version: ${info.version}`);
  sendDevLog(`[Updater] Release date: ${info.releaseDate}`);
  sendDevLog(`[Updater] Files: ${JSON.stringify(info.files)}`);
  sendUpdateStatus("available", info.version);
});

autoUpdater.on("update-not-available", (info) => {
  console.log(
    "[Updater] App is up to date (Current version:",
    app.getVersion(),
    ")",
  );
  sendDevLog(`[Updater] ❌ No update available`);
  sendDevLog(
    `[Updater] Current: ${app.getVersion()} | Latest: ${info.version}`,
  );
  sendDevLog(`[Updater] Release date checked: ${info.releaseDate}`);
  sendUpdateStatus("up-to-date", app.getVersion());
});

autoUpdater.on("download-progress", (progressObj) => {
  let log_message = "Download speed: " + progressObj.bytesPerSecond;
  log_message = log_message + " - Downloaded " + progressObj.percent + "%";
  log_message =
    log_message +
    " (" +
    progressObj.transferred +
    "/" +
    progressObj.total +
    ")";
  console.log("[Updater] " + log_message);
  sendUpdateStatus("downloading", Math.round(progressObj.percent));
});

autoUpdater.on("update-downloaded", (info) => {
  console.log("[Updater] Update downloaded:", info.version);
  sendUpdateStatus("downloaded", info.version);

  // Show custom update prompt
  createUpdatePromptWindow();
});

autoUpdater.on("error", (err) => {
  console.error("[Updater] Error in auto-updater: ", err);
  sendDevLog(`[Updater] ⚠️ ERROR: ${err.message}`);
  sendDevLog(`[Updater] Stack: ${err.stack}`);
  sendUpdateStatus("error", err.message || "Unknown error");
});

app.on("window-all-closed", (e) => {
  if (!isQuitting) e.preventDefault();
});

app.on("before-quit", () => {
  isQuitting = true;
  // Close the HTTP server to prevent port lingering
  if (server) {
    server.close(() => {
      console.log("Server closed");
    });
  }
});

app.on("activate", () => {
  if (win === null) {
    createWindow();
  } else {
    win.show();
  }
});
