// main.js
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  Tray,
  Menu,
  nativeImage,
  shell, // Added shell
  protocol, // Added protocol
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
  signInWithCustomToken,
  signInWithCredential,
  GoogleAuthProvider,
} = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");

// ---- CONFIG ----
require("dotenv").config();

// Asset Path Helper for Production (app.asar support)
const getAssetPath = (...paths) => {
  // Always use __dirname because assets are inside the ASAR with the code
  return path.join(__dirname, ...paths);
};

let win; // Moved to top to avoid TDZ issues
// ----------------- AI ROTATION -----------------
const DEFAULT_MODELS = ["gemini-2.0-flash", "gemini-1.5-flash"];
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

  // No longer migrating gemini-2.5-flash-lite/flash to gemini-1.5-flash.
  // These models are valid and preferred if available for the API key.

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
let requiredAIKeys = []; // single-key for AI mode
let requiredChatKeys = []; // single-key for Chat mode
let running = false;
let pressStart = null;
let isPersistent = false;
let lastReleaseTime = 0;
let lastReleaseKey = null;
let capturedSelection = "";
let selectionMemory = ""; // Background persistent memory for selection
let isCapturing = false; // Prevents overlapping capture calls
let holdTimeout = null;
let captureTimeout = null; // Debounce for capture

let isProcessingAI = false; // Prevents concurrent AI tasks
let currentChatSession = {
  id: Date.now().toString(),
  title: "New Chat",
  messages: [], // Array of { role: "user" | "model", parts: [{ text: "..." }] }
};
let tray = null;
let isQuitting = false;
let server = null; // Store server reference for cleanup
let chatWin = null; // New Cluely-style chat overlay

if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient("woodls", process.execPath, [
      path.resolve(process.argv[1]),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient("woodls");
}

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
      // Ensure it's in the taskbar
      win.setSkipTaskbar(false);
    }
    // Handle Deep Link
    const url = commandLine.find((arg) => arg.startsWith("woodls://"));
    if (url) handleDeepLink(url);
  });
}

// Handle Deep Link on macOS
app.on("open-url", (event, url) => {
  event.preventDefault();
  handleDeepLink(url);
});

async function handleDeepLink(url) {
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol === "woodls:" && urlObj.hostname === "auth") {
      const token = urlObj.searchParams.get("token"); // Custom Token
      const idToken = urlObj.searchParams.get("idToken"); // Google ID Token

      if (token) {
        console.log("Received Custom Auth Token via Deep Link");
        await signInWithCustomToken(auth, token);
      } else if (idToken) {
        const accessToken = urlObj.searchParams.get("accessToken");
        console.log("Received ID Token via Deep Link. Length:", idToken.length);
        console.log("Access Token present:", !!accessToken);

        const credential = GoogleAuthProvider.credential(idToken, accessToken);
        await signInWithCredential(auth, credential);
        console.log("Successfully signed in with ID Token");

        // ONLY show and focus on success
        if (win && !win.isDestroyed()) {
          win.show();
          win.focus();
        }
      } else if (
        urlObj.searchParams.has("email") &&
        urlObj.searchParams.has("password")
      ) {
        const encodedEmail = urlObj.searchParams.get("email");
        const encodedPassword = urlObj.searchParams.get("password");

        const email = Buffer.from(encodedEmail, "base64").toString("utf8");
        const password = Buffer.from(encodedPassword, "base64").toString(
          "utf8",
        );

        console.log("Received Email Credentials via Deep Link");
        const cred = await signInWithEmailAndPassword(auth, email, password);

        currentUser = {
          uid: cred.user.uid,
          email: cred.user.email,
          displayName: cred.user.displayName,
          photoURL: cred.user.photoURL,
        };
        saveGlobalSettings({ lastUser: currentUser });
        onUserChanged();

        if (win && !win.isDestroyed()) {
          win.webContents.send("auth-state-changed", currentUser);
          win.show();
          win.focus();
        }
        console.log("Successfully signed in with Email Credentials");
      }
    }
  } catch (e) {
    console.error("Deep link error:", e);
  }
}

// Check for deep link at startup (Windows)
const deepLinkUrl = process.argv.find((arg) => arg.startsWith("woodls://"));
if (deepLinkUrl) {
  // We might not be ready yet, defer it
  app.whenReady().then(() => handleDeepLink(deepLinkUrl));
}

// ----------------- helpers -----------------
function readSettings() {
  try {
    const p = getUserPaths().settings;

    if (!fs.existsSync(p))
      return { hotkey: [], aiHotkey: [], chatHotkey: ["LEFT CTRL", "SLASH"] };
    const raw = fs.readFileSync(p, "utf8");
    const data = JSON.parse(raw);
    if (!data.chatHotkey) data.chatHotkey = ["LEFT CTRL", "SLASH"];
    return data;
  } catch (e) {
    return { hotkey: [], aiHotkey: [], chatHotkey: ["LEFT CTRL", "SLASH"] };
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
  requiredAIKeys = Array.isArray(settings.aiHotkey) ? settings.aiHotkey : [];
  requiredChatKeys = Array.isArray(settings.chatHotkey)
    ? settings.chatHotkey
    : [];
  if (win && !win.isDestroyed()) {
    win.webContents.send("settings-loaded", settings);
    win.webContents.send("hotkey-loaded", requiredKeys);
    win.webContents.send("ai-hotkey-loaded", requiredAIKeys);
    win.webContents.send("chat-hotkey-loaded", requiredChatKeys);
  }
}

function getUserPaths() {
  const suffix = currentUser ? `_${currentUser.uid}` : "_guest";
  return {
    history: path.join(app.getPath("userData"), `history${suffix}.json`),
    notes: path.join(app.getPath("userData"), `notes${suffix}.json`),
    settings: path.join(app.getPath("userData"), `settings${suffix}.json`),
    chats: path.join(app.getPath("userData"), `chats${suffix}.json`),
    screenshots: path.join(app.getPath("userData"), "screenshots"),
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

function readChatHistory() {
  try {
    const p = getUserPaths().chats;
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return [];
  }
}

function saveChatHistory(history) {
  try {
    const p = getUserPaths().chats;
    fs.writeFileSync(p, JSON.stringify(history, null, 2));
  } catch (e) {
    console.error("Failed to save chat history:", e);
  }
}

function ensureScreenshotsDir() {
  const p = getUserPaths().screenshots;
  if (!fs.existsSync(p)) {
    fs.mkdirSync(p, { recursive: true });
  }
}

// Normalize key names to a stable canonical form.
function normalizeKeyName(raw) {
  if (!raw) return "";

  const base = String(raw).toUpperCase().trim();
  // Remove all non-alphanumeric characters
  const normalized = base.replace(/[^A-Z0-9]/gi, "");

  // If normalized is empty (e.g. for symbols), fallback to base
  const final = normalized || base;

  // Handle word order variations: "LEFT ALT" vs "ALT LEFT" -> both become "LEFTALT"
  const modifiers = ["ALT", "CTRL", "CONTROL", "SHIFT", "META", "SUPER", "WIN"];
  const positions = ["LEFT", "RIGHT"];

  for (const pos of positions) {
    for (const mod of modifiers) {
      const pattern1 = pos + mod;
      const pattern2 = mod + pos;
      if (final === pattern1 || final === pattern2) {
        return pos + (mod === "CONTROL" ? "CTRL" : mod);
      }
    }
  }

  return final;
}

// Helper to get conditional context block
function getContextPrompt(isTranscription = false) {
  if (!capturedSelection) return "";

  if (isTranscription) {
    return `
[BACKGROUND CONTEXT (OPTIONAL)]
The user has the following text selected on their screen. ONLY use this to help with the spelling of technical terms or names mentioned in the audio. DO NOT answer questions based on this text.
Selected Text: "${capturedSelection}"
`;
  }

  return `
[BACKGROUND CONTEXT]
The user has the following text selected on its screen. Use this context if the user's request references it (e.g., "Summarize this").
Selected Text: "${capturedSelection}"
`;
}

let lastCaptureTime = 0;
// Helper to capture currently selected text
async function captureSelection() {
  const now = Date.now();
  if (isCapturing || isProcessingAI || now - lastCaptureTime < 800) return;
  lastCaptureTime = now;
  isCapturing = true;

  const { clipboard } = require("electron");
  const originalClipboard = clipboard.readText();

  // Trigger Copy (Ctrl+C or Cmd+C)
  const mod = process.platform === "darwin" ? "command" : "control";

  // Use setTimeout to ensure the keyboard hook returns true and blocks the hotkey BEFORE robot sends commands.
  // This definitively fixes the race condition that causes "Ctrl + [Hotkey]" on first press.
  setTimeout(async () => {
    try {
      // --- SAFETY RELEASE ---
      // Release ALL modifier keys to prevent leaks to other apps (e.g., Ctrl+1 in browser)
      robot.keyToggle("control", "up");
      robot.keyToggle("shift", "up");
      robot.keyToggle("alt", "up");
      robot.keyToggle("command", "up"); // This is the Windows/Meta key

      // Explicit sequence for better reliability on Windows
      robot.keyToggle(mod, "down");
      robot.keyTap("c");
      robot.keyToggle(mod, "up");

      // Sync delay (300ms for Windows stability)
      await new Promise((res) => setTimeout(res, 300));

      const newCaptured = clipboard.readText();

      // ... same logic as before ...
      if (
        newCaptured &&
        newCaptured !== originalClipboard &&
        newCaptured !== selectionMemory
      ) {
        capturedSelection = newCaptured.trim();
        selectionMemory = capturedSelection;
        sendDevLog(`✅ Captured: "${capturedSelection.substring(0, 50)}..."`);
      } else {
        capturedSelection = "";
        sendDevLog(`❌ Nothing new captured`);
      }

      if (newCaptured !== originalClipboard) {
        clipboard.writeText(originalClipboard);
      }
    } catch (e) {
      console.error("Capture selection error:", e);
      capturedSelection = "";
    } finally {
      isCapturing = false;
    }
  }, 50);
}

let overlayWin;
let copyOverlayWin;

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
  try {
    // Windows standard is 16x16 small, 32x32 large.
    // Use .ico for Windows tray if available for best compatibility
    const trayIconPath =
      process.platform === "win32"
        ? getAssetPath("build", "woodls.ico")
        : getAssetPath("webp", "woodls.png");

    const icon = nativeImage.createFromPath(trayIconPath);
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
      saveGlobalSettings({ lastUser: currentUser });
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
      saveGlobalSettings({ lastUser: currentUser });
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
      saveGlobalSettings({ lastUser: currentUser });
    } else {
      currentUser = null;
      saveGlobalSettings({ lastUser: null });
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
      saveGlobalSettings({ lastUser: null });
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
  requiredAIKeys = Array.isArray(settings.aiHotkey) ? settings.aiHotkey : [];
  requiredChatKeys = Array.isArray(settings.chatHotkey)
    ? settings.chatHotkey
    : [];

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("hotkey-loaded", requiredKeys);
    win.webContents.send("ai-hotkey-loaded", requiredAIKeys);
    win.webContents.send("chat-hotkey-loaded", requiredChatKeys);
    win.webContents.send("settings-loaded", settings);
    sendAIInfoToRenderer();
  });

  // Close overlay when main window closes
  win.on("closed", () => {
    if (overlayWin) overlayWin.destroy();
    win = null;
  });

  // Register custom protocol for screenshots
  protocol.registerFileProtocol("woodls-screenshot", (request, callback) => {
    const url = request.url.replace("woodls-screenshot://", "");
    try {
      const p = path.join(getUserPaths().screenshots, url);
      return callback(p);
    } catch (error) {
      console.error("Failed to register protocol", error);
    }
  });

  createOverlayWindow();
  createChatWindow();

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
        saveGlobalSettings({ lastUser: currentUser });
      } else {
        // Only clear if it was a firebase login, to avoid clearing synced user
        // but normally sign out happens via handlers
        // currentUser = null;
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

function createChatWindow() {
  if (chatWin && !chatWin.isDestroyed()) return;

  const { width, height } =
    require("electron").screen.getPrimaryDisplay().workAreaSize;

  // Modern chat overlay size
  const w = 550;
  const h = 450;
  const x = Math.round((width - w) / 2);
  const y = height - h - 100; // Positioned slightly above the taskbar

  chatWin = new BrowserWindow({
    width: w,
    height: h,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true, // Allow resizing if user wants
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    hasShadow: false,
    type: "toolbar",
  });

  // CLUELY FEATURE: Make window invisible to screenshots/recordings
  chatWin.setContentProtection(true);

  chatWin.loadFile("chat.html");
  chatWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
}

function createOverlayWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return;

  const { width, height } =
    require("electron").screen.getPrimaryDisplay().workAreaSize;

  // Pill size (Responsive for buttons)
  const w = 140;
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
  createCopyOverlayWindow();
}

function createCopyOverlayWindow() {
  if (copyOverlayWin && !copyOverlayWin.isDestroyed()) return;

  const { width, height } =
    require("electron").screen.getPrimaryDisplay().workAreaSize;

  const w = 300;
  const h = 140;
  // Position it centered, slightly above the main overlay
  const x = Math.round((width - w) / 2);
  const y = height - h - 80; // 80px from bottom

  copyOverlayWin = new BrowserWindow({
    width: w,
    height: h,
    x: x,
    y: y,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    focusable: true,
    hasShadow: true, // Shadow for toast
    type: "toolbar",
  });

  copyOverlayWin.loadFile("copy_popup.html");
  copyOverlayWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
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
  console.log(
    `[IPC] show-overlay called. AI: ${aiEnabled}, isPersistent: ${isPersistent}`,
  );
  if (overlayWin && !overlayWin.isDestroyed()) {
    const { width: screenWidth, height: screenHeight } =
      require("electron").screen.getPrimaryDisplay().workAreaSize;

    const w = 140;
    const h = 40;
    const x = Math.round((screenWidth - w) / 2);
    const y = screenHeight - h - 10;

    overlayWin.setBounds({ width: w, height: h, x: x, y: y });
    overlayWin.showInactive();
    overlayWin.setAlwaysOnTop(true, "screen-saver");
    overlayWin.setIgnoreMouseEvents(false);
    overlayWin.webContents.send("set-ai-status", !!aiEnabled);

    overlayWin.webContents.send("set-controls", {
      showCancel: true,
      showConfirm: isPersistent,
    });
  } else {
    console.warn("[IPC] show-overlay failed: overlayWin is null or destroyed");
  }
});

ipcMain.on("set-overlay-clickable", (event, clickable) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.setIgnoreMouseEvents(!clickable);
  }
});

ipcMain.on("cancel-recording", () => {
  if (running) {
    running = false;
    isPersistent = false;
    if (holdTimeout) {
      clearTimeout(holdTimeout);
      holdTimeout = null;
    }
    // Notify renderer to discard recording
    if (win && !win.isDestroyed()) {
      win.webContents.send("recording-cancelled");
    }
    // Hide overlay
    if (overlayWin && !overlayWin.isDestroyed()) {
      overlayWin.hide();
    }
    isProcessingAI = false; // Reset blocking state
  }
});

ipcMain.on("processing-start", () => {
  isProcessingAI = true;
});

ipcMain.on("processing-end", () => {
  isProcessingAI = false;
});

ipcMain.on("confirm-recording", () => {
  if (running) {
    stopAndTranscribe();
  }
});

ipcMain.on("show-copy-popup", (event, text) => {
  if (copyOverlayWin && !copyOverlayWin.isDestroyed()) {
    copyOverlayWin.webContents.send("set-text", text);
    copyOverlayWin.showInactive();
    copyOverlayWin.setAlwaysOnTop(true, "screen-saver");
  }
});

ipcMain.on("hide-copy-popup", () => {
  if (copyOverlayWin && !copyOverlayWin.isDestroyed()) {
    copyOverlayWin.hide();
  }
});

ipcMain.on("copy-text", (event, text) => {
  clipboard.writeText(text);
  if (copyOverlayWin && !copyOverlayWin.isDestroyed()) {
    copyOverlayWin.hide();
  }
  // Also hide main overlay when copy is done
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.hide();
  }
});

ipcMain.on("hide-overlay", () => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.hide();
  }
});

ipcMain.handle("capture-screen", async () => {
  const { desktopCapturer, screen } = require("electron");
  try {
    const primaryDisplay = screen.getPrimaryDisplay();
    const { width, height } = primaryDisplay.size;

    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width, height },
    });

    const primarySource = sources[0]; // Usually the first one
    if (primarySource) {
      return primarySource.thumbnail.toDataURL();
    }
    return null;
  } catch (e) {
    console.error("Screen capture failed:", e);
    return null;
  }
});

ipcMain.handle("capture-screen-only", async () => {
  console.log("[IPC] capture-screen-only called");
  try {
    const { desktopCapturer } = require("electron");
    const sources = await desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 1280, height: 720 }, // Lower res for preview
    });
    const primarySource = sources[0];
    if (!primarySource) return null;
    return primarySource.thumbnail.toDataURL().split(",")[1]; // Return base64
  } catch (e) {
    console.error("Capture failed:", e);
    return null;
  }
});
ipcMain.on("chat-query", async (event, data) => {
  const { query, attachedScreenshot } = data;
  console.log("[IPC] chat-query received:", {
    query,
    hasScreenshot: !!attachedScreenshot,
  });

  try {
    // 1. Get Screenshot (either from attachment or capture now if requested specifically)
    let screenshotBase64 = attachedScreenshot;
    let screenshotName = null;

    if (screenshotBase64) {
      ensureScreenshotsDir();
      screenshotName = `chat_${Date.now()}.png`;
      const screenshotPath = path.join(
        getUserPaths().screenshots,
        screenshotName,
      );
      fs.writeFileSync(screenshotPath, Buffer.from(screenshotBase64, "base64"));
    }

    // 2. Send to Gemini with threading
    if (!genAI) throw new Error("AI not initialized");
    const modelOptions = {
      model: currentModelName || "gemini-1.5-flash",
      systemInstruction:
        "You are a precise, helpful AI assistant. Provide short, direct answers. Use Markdown for formatting. If requested to write code, provide ONLY the explanation and the code block. Do not be conversational unless asked.",
    };
    const model = genAI.getGenerativeModel(modelOptions);

    // Initial message if session is new
    if (currentChatSession.messages.length === 0) {
      currentChatSession.title =
        query.slice(0, 40) + (query.length > 40 ? "..." : "");
    }

    const chat = model.startChat({
      history: currentChatSession.messages,
    });

    let result;
    if (screenshotBase64) {
      // Multimedia messages are currently better handled by generateContent directly if we don't want to keep a complex multi-part history in memory
      // But for threading, we should try to keep the text context
      result = await chat.sendMessage([
        { text: query },
        {
          inlineData: {
            data: screenshotBase64,
            mimeType: "image/png",
          },
        },
      ]);
    } else {
      result = await chat.sendMessage(query);
    }

    const response = await result.response;
    const responseText = response.text();

    // 3. Save to History (Both global and current session)
    const chatHistory = readChatHistory();
    const entry = {
      id: Date.now().toString(),
      sessionId: currentChatSession.id,
      sessionTitle: currentChatSession.title,
      timestamp: Date.now(),
      query: query,
      response: responseText,
      screenshot: screenshotName,
    };
    chatHistory.push(entry);
    saveChatHistory(chatHistory);

    // Update current session messages for threading
    // sendMessage already updates the internal 'chat' object history,
    // but we might want to sync it if we want persistent sessions across restarts (not implemented yet)
    // For now, it stays in memory.

    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send("chat-response", {
        text: responseText,
        sessionId: currentChatSession.id,
        sessionTitle: currentChatSession.title,
      });
    }
  } catch (e) {
    console.error("Chat query failed:", e);
    if (chatWin && !chatWin.isDestroyed()) {
      chatWin.webContents.send("chat-error", e.message);
    }
  }
});

ipcMain.on("new-chat-session", () => {
  currentChatSession = {
    id: Date.now().toString(),
    title: "New Chat",
    messages: [],
  };
  console.log("[AI] New chat session started:", currentChatSession.id);
  if (chatWin && !chatWin.isDestroyed()) {
    chatWin.webContents.send("session-reset");

    // Reset Window Size & Position (User Request: "Trim this down")
    // Re-calculate default position (Center bottom)
    const { width, height } =
      require("electron").screen.getPrimaryDisplay().workAreaSize;
    const w = 550;
    const h = 450;
    const x = Math.round((width - w) / 2);
    const y = height - h - 100;

    if (chatWin.isMaximized()) chatWin.unmaximize();
    chatWin.setBounds({ x, y, width: w, height: h }, true); // animate
  }
});

ipcMain.handle("get-chat-history", () => {
  return readChatHistory().reverse(); // Newest first
});

ipcMain.handle("delete-chat-session", (_, sessionId) => {
  let history = readChatHistory();
  // Filter out items belonging to this session
  const beforeCount = history.length;
  history = history.filter((item) => item.sessionId !== sessionId);
  const afterCount = history.length;

  if (beforeCount !== afterCount) {
    saveChatHistory(history);
    return true;
  }
  return false;
});

ipcMain.on("mic-volume", (event, volume) => {
  if (overlayWin && !overlayWin.isDestroyed()) {
    overlayWin.webContents.send("mic-volume", volume);
  }
});

ipcMain.on("resize-chat", (event, { width, height }) => {
  if (chatWin && !chatWin.isDestroyed()) {
    // Optional: animate? Electron doesn't animate resize well natively, but we'll set it.
    // Maintain x/y position but change size.
    // However, if we shrink height, we want it to stay at the "bottom" or "center"?
    // The current positioning logic in createChatWindow puts it near bottom: y = height - h - 100.
    // If we resize, we probably want to keep the bottom position fixed?
    // Let's see. The user said "expand it once the chat begins".
    // If it expands UPWARDS, we need to adjust Y.

    const bounds = chatWin.getBounds();
    const newHeight = height || bounds.height;
    const newWidth = width || bounds.width;

    // Check if we need to adjust Y to make it grow upwards
    // Old bottom = bounds.y + bounds.height
    // New bottom should be same?
    // newY = (bounds.y + bounds.height) - newHeight

    // BUT createChatWindow uses: y = screenHeight - h - 100.
    // So the "anchor" is the bottom.

    // Let's recalculate Y based on the screen size to be safe, or just use current bounds.
    const currentBottom = bounds.y + bounds.height;
    const newY = currentBottom - newHeight;

    chatWin.setBounds({
      x: bounds.x,
      y: newY,
      width: newWidth,
      height: newHeight,
    });
  }
});

let lastChatReleaseTime = 0;
let lastChatReleaseKey = null;

ipcMain.on("show-chat", () => {
  if (!chatWin || chatWin.isDestroyed()) {
    createChatWindow();
  }
  chatWin.show();
  chatWin.focus();
});

// ----------------- global keyboard listener -----------------
// ... (rest of keyboard listener)
function setupGlobalKeyboard() {
  if (keyboard) return;
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener((event) => {
    const rawName = event && event.name ? String(event.name) : "";
    if (!rawName) return;

    const key = normalizeKeyName(rawName);
    const HOTKEY =
      requiredKeys && requiredKeys[0]
        ? normalizeKeyName(requiredKeys[0])
        : null;
    const AI_HOTKEY =
      requiredAIKeys && requiredAIKeys[0]
        ? normalizeKeyName(requiredAIKeys[0])
        : null;
    const settings = readSettings();
    const CHAT_HOTKEY =
      settings.chatHotkey && settings.chatHotkey[0]
        ? normalizeKeyName(settings.chatHotkey[0])
        : null;

    if (!HOTKEY && !AI_HOTKEY && !CHAT_HOTKEY) return;

    // Determine which key was pressed and set mode
    let isAIMode = false;
    let isActiveKey = false;
    let targetHotkey = null;

    if (key && key === HOTKEY) {
      isActiveKey = true;
      isAIMode = false;
      targetHotkey = HOTKEY;
    } else if (key && key === AI_HOTKEY) {
      isActiveKey = true;
      isAIMode = true;
      targetHotkey = AI_HOTKEY;
    } else if (key && key === CHAT_HOTKEY) {
      // NEW: Cluely-style chat overlay
      if (event.state === "DOWN") {
        const now = Date.now();
        // DOUBLE TAP Logic for Chat Panel
        if (now - lastChatReleaseTime < 600 && lastChatReleaseKey === key) {
          if (chatWin && !chatWin.isDestroyed() && chatWin.isVisible()) {
            chatWin.hide();
          } else {
            if (!chatWin || chatWin.isDestroyed()) createChatWindow();
            chatWin.show();
            chatWin.focus();
          }
        }
      } else if (event.state === "UP") {
        lastChatReleaseTime = Date.now();
        lastChatReleaseKey = key;
      }
      return true; // Block hotkey
    }

    if (event.state === "DOWN" && isActiveKey) {
      const now = Date.now();

      // Always block if AI is thinking
      if (isProcessingAI) {
        sendDevLog("⚠️ Activity blocked: AI is thinking.");
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("show-busy");
        }
        return true;
      }

      // Block if hold-to-record is active (prevents overlapping triggers)
      // BUT allow if isPersistent is true (allows the "Stop" click below)
      if (running && !isPersistent) {
        sendDevLog("⚠️ Activity blocked: Already recording.");
        if (overlayWin && !overlayWin.isDestroyed()) {
          overlayWin.webContents.send("show-busy");
        }
        return true;
      }

      // Double-Tap Logic: Must be the SAME key
      if (
        now - lastReleaseTime < 600 &&
        !running &&
        !isPersistent &&
        lastReleaseKey === key
      ) {
        if (holdTimeout) {
          clearTimeout(holdTimeout);
          holdTimeout = null;
        }

        // Cancel any pending capture from the first tap to prevent conflict
        if (captureTimeout) {
          clearTimeout(captureTimeout);
          captureTimeout = null;
        }

        // Capture now for the persistent session
        captureSelection();

        isPersistent = true;
        running = true;
        pressStart = now;
        win.webContents.send("record-start", {
          persistent: true,
          aiMode: isAIMode,
        });
        win.webContents.send("hotkey-pressed", {
          key: targetHotkey,
          time: pressStart,
        });
        return true; // Block double tap
      }

      // Start capturing selection with a DELAY to avoid interfering with double-tap
      if (!running && !holdTimeout) {
        if (captureTimeout) clearTimeout(captureTimeout);
        captureTimeout = setTimeout(() => {
          captureSelection();
          captureTimeout = null;
        }, 250); // 250ms delay
      }

      // Already recording in persistent mode -> Stop it
      if (isPersistent && running) {
        stopAndTranscribe();
        return true; // Block stop tap
      }

      // Standard Hold-to-Record Logic
      if (!running) {
        holdTimeout = setTimeout(() => {
          running = true;
          pressStart = Date.now();

          // Ensure capture happens if it hasn't yet (e.g. if we set delay > 500ms, which we didn't)
          // But with 250ms, it should have run.

          win.webContents.send("record-start", {
            persistent: false,
            aiMode: isAIMode,
          });
          win.webContents.send("hotkey-pressed", {
            key: targetHotkey,
            time: pressStart,
          });
        }, 500);
      }
    }

    if (event.state === "UP" && isActiveKey) {
      if (holdTimeout) {
        clearTimeout(holdTimeout);
        holdTimeout = null;
      }

      lastReleaseTime = Date.now();
      lastReleaseKey = key;

      if (running && !isPersistent) {
        stopAndTranscribe();
      }
    }

    // BLOCK the hotkey from reaching other applications (e.g., to prevent browser shortcuts like Ctrl+1)
    if (isActiveKey) {
      return true;
    }
  });
}

function stopAndTranscribe() {
  running = false;
  isPersistent = false;

  const releaseTime = Date.now();
  const duration = releaseTime - (pressStart || releaseTime);
  lastDuration = duration;
  pressStart = null;

  const HOTKEY =
    requiredKeys && requiredKeys[0] ? normalizeKeyName(requiredKeys[0]) : null;

  win.webContents.send("record-stop");

  win.webContents.send("hotkey-released", {
    key: null,
    releaseTime,
    duration,
  });

  // DO NOT hide overlay here - let processing-start/end handle it in renderer
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
  applyStartupSettings(openAtLogin, startHidden);
});

function applyStartupSettings(openAtLogin, startHidden) {
  app.setLoginItemSettings({
    openAtLogin: openAtLogin,
    path: app.getPath("exe"),
    args: startHidden ? ["--hidden"] : [],
  });
  // Save to global settings so it persists before user login
  saveGlobalSettings({ openAtLogin, startHidden });
}

ipcMain.on("get-startup-settings", (event) => {
  const { openAtLogin } = app.getLoginItemSettings();
  // Read from global settings for UI state
  const globalSettings = readGlobalSettings();
  event.reply("startup-settings-loaded", {
    openAtLogin:
      globalSettings.openAtLogin !== undefined
        ? globalSettings.openAtLogin
        : openAtLogin,
    startHidden:
      globalSettings.startHidden !== undefined
        ? globalSettings.startHidden
        : true,
  });
});

ipcMain.on("get-hotkey", (event) => {
  event.reply("hotkey-loaded", requiredKeys);
});

// ----------------- IPC: AI Hotkey management -----------------
ipcMain.on("save-ai-hotkey", (event, keys) => {
  const normalized = (keys || []).map((k) => normalizeKeyName(k));
  requiredAIKeys = normalized;
  saveSettings({ aiHotkey: normalized });
  event.reply("ai-hotkey-saved", normalized);
});

ipcMain.on("clear-ai-hotkey", (event) => {
  requiredAIKeys = [];
  saveSettings({ aiHotkey: [] });
  event.reply("ai-hotkey-cleared");
});

// ----------------- IPC: Chat Hotkey management -----------------
ipcMain.on("save-chat-hotkey", (event, keys) => {
  const normalized = (keys || []).map((k) => normalizeKeyName(k));
  requiredChatKeys = normalized;
  saveSettings({ chatHotkey: normalized });
  event.reply("chat-hotkey-saved", normalized);
});

ipcMain.on("clear-chat-hotkey", (event) => {
  requiredChatKeys = [];
  saveSettings({ chatHotkey: [] });
  event.reply("chat-hotkey-cleared");
});

ipcMain.on("get-chat-hotkey", (event) => {
  event.reply("chat-hotkey-loaded", requiredChatKeys);
});

ipcMain.on("get-ai-hotkey", (event) => {
  event.reply("ai-hotkey-loaded", requiredAIKeys);
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
  if (overlayWin) {
    overlayWin.webContents.send("processing-start", {
      hasSelection: !!capturedSelection,
    });
  }
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
    // Increase delay to ensure target app is focused and ready
    await new Promise((res) => setTimeout(res, 150));
    // Ctrl+V or Cmd+V
    const mod = process.platform === "darwin" ? "command" : "control";
    robot.keyTap("v", mod);
    // Extra safety release for control key
    if (process.platform !== "darwin") {
      robot.keyToggle("control", "up");
    }
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

ipcMain.handle("transcribe-audio", async (_, arrayBuffer, context) => {
  const maxRetries = 3; // Allow more retries for multi-key
  let attempt = 0;
  let savePath;

  // Default prompt (fallback)
  let systemPrompt = "Transcribe this audio to plain text only: ";

  if (true) {
    systemPrompt = `
You are a versatile AI Assistant. 
Your primary goal is to help me with the task I dictate, tailored to the platform I am currently using.

1. If the input is just conversational or descriptive text, rewrite it with proper punctuation, grammar, formatting, and clarity.
2. **Formatting Rules (CRITICAL)**:
    - NO Timestamps: Never include 00:00:00 style timestamps.
    - Numbered lists (1. 2. 3.), OR
    - Alphabetical lists (a. b. c.), based on what reads more naturally.
3. Return **ONLY the final result**. No conversational filler., no "Here is your text...", no explanations, no quotes. 

${getContextPrompt(true)}

[TASK]
Transcribe the provided audio recording into clear, natural text. 
Follow these formatting rules:
1. Rewrite conversational or descriptive text with proper punctuation and grammar.
2. NO Timestamps: Never include 00:00:00 style timestamps.
3. Formatting: Use numbered lists (1. 2. 3.) or alphabetical lists (a. b. c.) if the content dictates structure.
4. Return ONLY the final result. No explanations, no quotes, no intros.

    `;
  }

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
        systemPrompt,
        {
          fileData: {
            mimeType: upload.file.mimeType,
            fileUri: upload.file.uri,
          },
        },
      ]);

      const text = result.response.text();

      // Log transcription details
      sendDevLog(`[Transcription Post-Prompt]: ${systemPrompt}`);
      sendDevLog(`[Transcribed Audio / Final Result]: ${text}`);

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

      // Log transcription details
      sendDevLog(
        `[Transcription Post-Prompt]: Transcribe this audio to plain text only: `,
      );
      sendDevLog(`[Transcribed Audio / Final Result]: ${text}`);

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
Your primary goal is to follow my given instructions and perform that task, tailored to the platform I am currently using.

1. If the input is a specific request or command execute that task as requested.
2. If the input is just conversational or descriptive text, rewrite it with proper punctuation, grammar, formatting, and clarity.
4. **Formatting Rules (CRITICAL)**:
   - **NO Timestamps**: Never include 00:00:00 style timestamps.
   - **Plan Formatting**: If the text contains a plan/schedule, break it into a numbered list (1, 2, 3). 
    1. Numbered lists (1. 2. 3.), OR
    a. Alphabetical lists (a. b. c.), based on what reads more naturally.
    - If the input contains bullet-style content, convert it into numbered steps while transcribing.
   - **Code**: If the user asks for code, PROVIDE THE CODE
   - **Headers**: Use markdown headers (###) ONLY if the topics are totally distinct.
5. Return **ONLY the final result**. No conversational filler., no "Here is your text...", no explanations, no quotes. 

${getContextPrompt(false)}

[TASK/USER INPUT]
Main Request: "${info}"

[INSTRUCTIONS]
Your goal is to follow the user's main request above. Only reference background material if the request is clearly about it.

1. If the request is a specific command, execute it faithfully.
2. If the request is for transcription/formatting, clean it up for clarity and grammar.
3. Formatting Rules:
   - NO Timestamps.
   - Use numbered lists (1. 2. 3.) for steps or schedules.
   - Provide code if requested.
   - Use ### headers ONLY for distinct topics.
4. Return ONLY the final result. No conversational filler, no intros.
`;

    // Log input and prompt
    sendDevLog(`[Transcribed Audio / Input]: ${info}`);
    sendDevLog(`[Generation Post-Prompt]: ${prompt}`);

    try {
      if (!genAI) throw new Error("AI not initialized.");
      const model = genAI.getGenerativeModel({ model: currentModelName });
      const result = await model.generateContent(prompt);
      let txt = result.response.text();

      // SUCCESS: Update usage for this specific Key + Model
      updateAIUsage(currentKeyIndex, currentModelName);

      // Extra safety cleanup for hallucinations
      txt = txt.replace(/\(\d{2}:\d{2}\)/g, "").trim();

      // Log final result
      sendDevLog(`[Final Result]: ${txt}`);

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
  // Restore User State
  const globalSettings = readGlobalSettings();
  if (globalSettings.lastUser) {
    currentUser = globalSettings.lastUser;
    console.log(`[Auth] Restored user: ${currentUser.email}`);
  }

  // Apply Startup Settings
  if (globalSettings.openAtLogin !== undefined) {
    applyStartupSettings(
      globalSettings.openAtLogin,
      globalSettings.startHidden || false,
    );
  }

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

ipcMain.handle("get-app-version", () => {
  return app.getVersion();
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

  // Default Standard Native Popup for Restart
  dialog
    .showMessageBox({
      type: "info",
      title: "Update Ready",
      message: `A new version (${info.version}) of Woodls has been downloaded.`,
      detail: "Restart the application to apply the update.",
      buttons: ["Restart to Update", "Later"],
      defaultId: 0,
      cancelId: 1,
    })
    .then((result) => {
      if (result.response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
});

autoUpdater.on("error", (err) => {
  console.error("[Updater] Error in auto-updater: ", err);
  sendDevLog(`[Updater] ⚠️ ERROR: ${err.message}`);
  sendDevLog(`[Updater] Stack: ${err.stack}`);
  sendUpdateStatus("error", err.message || "Unknown error");
});

app.on("window-all-closed", (e) => {
  if (!isQuitting) {
    e.preventDefault();
  } else if (process.platform !== "darwin") {
    app.quit();
  }
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
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
