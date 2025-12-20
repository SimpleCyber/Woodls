// main.js
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const activeWin = require("active-win");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // keep as placeholder
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const robot = require("@jitsi/robotjs");



// ---- CONFIG ----
const API_KEY = "AIzaSyDMeBypr5QwUdXAjVTRmfOmWnDXlcJNNK4"; // replace if you use GoogleGenerativeAI
const genAI = new GoogleGenerativeAI(API_KEY);

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

let win;
let keyboard;
let requiredKeys = []; // single-key expected (array but we use index 0)
let running = false;
let pressStart = null;

// ----------------- helpers -----------------
function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const data = JSON.parse(raw);
    return Array.isArray(data.hotkey) ? data.hotkey : [];
  } catch (e) {
    return [];
  }
}

function saveSettings(keys) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ hotkey: keys }, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// Normalize key names to a stable canonical form.
// Removes non-alphanumeric and uppercases. Matches renderer's normalization.
function normalizeKeyName(raw) {
  if (!raw) return "";
  return String(raw).replace(/[^a-z0-9]/gi, "").toUpperCase();
}

let overlayWin;

// ----------------- create window -----------------
function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 760,
    frame: false, // Custom title bar
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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

  win.loadFile("index.html");

  requiredKeys = readSettings();

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("hotkey-loaded", requiredKeys);
  });
  
  // Close overlay when main window closes
  win.on('closed', () => {
    if (overlayWin) overlayWin.destroy();
    win = null;
  });

  createOverlayWindow();

  setupGlobalKeyboard();
  startActiveWindowMonitor();
}

function createOverlayWindow() {
  overlayWin = new BrowserWindow({
    maxWidth: 200,
    maxHeight: 200,
    width: 200,
    height: 200,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false, // hidden by default
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false, // Simpler for this small overlay
    },
    focusable: false, // Don't steal focus
    hasShadow: false,
  });
  
  overlayWin.setIgnoreMouseEvents(true); // Click through
  overlayWin.loadFile("overlay.html");
}

// ----------------- Active Window Monitor -----------------
function startActiveWindowMonitor() {
  setInterval(async () => {
    try {
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
ipcMain.on("save-hotkey", (event, keys) => {
  // keys expected like ["NUMPAD8"] (from renderer) - normalize before saving
  const normalized = (keys || []).map(k => normalizeKeyName(k));
  requiredKeys = normalized;
  saveSettings(normalized);
  event.reply("hotkey-saved", normalized);
});

ipcMain.on("clear-hotkey", (event) => {
  requiredKeys = [];
  saveSettings([]);
  event.reply("hotkey-cleared");
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


// ----------------- Auto Type --------------------------
ipcMain.handle("auto-type", async (_, text) => {
  try {
    if (!text || typeof text !== "string") return "No text";

    await new Promise(res => setTimeout(res, 1)); // ensure focus

    robot.typeString(text);
    return "typed";
  } catch (e) {
    console.error("Auto-type error:", e);
    return "error";
  }
});




// ----------------- IPC: speech to text -----------------

ipcMain.handle("transcribe-audio", async (_, arrayBuffer) => {
  try {
    const fileManager = new GoogleAIFileManager(API_KEY);

    // create a temp file
    const tempPath = path.join(app.getPath("temp"), "recording.webm");
    fs.writeFileSync(tempPath, Buffer.from(arrayBuffer));

    // upload the audio
    const upload = await fileManager.uploadFile(tempPath, {
      mimeType: "audio/webm",
      displayName: "hotkey-recording",
    });

    // now transcribe
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

    const result = await model.generateContent([
      "Transcribe this audio to plain text only: ",

      {
        fileData: {
          mimeType: upload.file.mimeType,
          fileUri: upload.file.uri,
        }
      }
    ]);

    return result.response.text();
  } catch (err) {
    console.error("Transcription error:", err);
    return "Error: " + err.message;
  }
});


// ----------------- IPC: LLM generation (placeholder) -----------------
ipcMain.handle("generate-text", async (_, { info, assistantName, appName }) => {
  const prompt = `
You are my AI assistant.
Your job is to rewrite the given input text with proper punctuation, grammar, formatting, and clarity.  
Rewrite it as if I am describing something to you, and you are returning a refined version of what I should write.  
Return **only the rewritten output**, nothing extra.

Sometimes, I will also provide the context or platform where I am writing the message (e.g., Email, Slack, WhatsApp, Message, Notepad, Notes, Notion, VS Code, or when passing a prompt to another AI bot).  
In such cases, rewrite the content in the style and tone appropriate for that platform.

Occasionally, I may ask you to perform a task instead of rewriting.  
In those cases, complete the task *if u feel I explicitly asked to write insted or rewrite*.
Always return the content only
App: ${appName}
Text: "${info}"
`;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err) {
    return "Error: " + (err && err.message ? err.message : String(err));
  }
});

// ----------------- app lifecycle -----------------
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

