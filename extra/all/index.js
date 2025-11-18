// index.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const { nodewhisper } = require("nodejs-whisper");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

let win;
let keyboard;
let requiredKeys = [];
let currentPressed = new Set();
let running = false;
let pressStart = null;

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.hotkey)) return parsed.hotkey;
  } catch (e) {}
  return [];
}

function saveSettings(keys) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ hotkey: keys }, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

function normalizeKeyName(k) {
  return String(k).toUpperCase();
}

function createWindow() {
  win = new BrowserWindow({
    width: 980,
    height: 820,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  win.loadFile("index.html");

  requiredKeys = readSettings();

  win.webContents.on("did-finish-load", () => {
    win.webContents.send("hotkey-loaded", requiredKeys);
  });

  setupGlobalListener();
}

function setupGlobalListener() {
  if (keyboard) return;
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener((event) => {
    // event: { state: "DOWN"|"UP", name: "A"|... }
    const key = normalizeKeyName(event.name || "");

    if (event.state === "DOWN") {
      currentPressed.add(key);

      if (!running && requiredKeys.length > 0) {
        const allDown = requiredKeys.every((k) => currentPressed.has(k));
        if (allDown) {
          running = true;
          pressStart = Date.now();
          win.webContents.send("hotkey-pressed", {
            keys: requiredKeys,
            time: pressStart,
          });
        }
      }
    }

    if (event.state === "UP") {
      // remove from set
      currentPressed.delete(key);

      if (running && requiredKeys.includes(key)) {
        const releaseTime = Date.now();
        const duration = releaseTime - pressStart;
        running = false;
        pressStart = null;

        win.webContents.send("hotkey-released", {
          keys: requiredKeys,
          releaseTime,
          duration,
        });
      }
    }
  });
}

// Save hotkey
ipcMain.on("save-hotkey", (e, keys) => {
  requiredKeys = (keys || []).map(normalizeKeyName);
  saveSettings(requiredKeys);
  e.reply("hotkey-saved", requiredKeys);
});

// Clear hotkey
ipcMain.on("clear-hotkey", (e) => {
  requiredKeys = [];
  saveSettings([]);
  e.reply("hotkey-cleared");
});

// get hotkey
ipcMain.on("get-hotkey", (e) => {
  e.reply("hotkey-loaded", requiredKeys);
});

/**
 * Handle incoming base64 audio buffer from renderer,
 * write to temp file, call nodejs-whisper, remove file, return transcript + detected language (if available).
 *
 * Renderer will call via: ipcRenderer.invoke('transcribe-audio-buffer', { data: base64, filename })
 */
ipcMain.handle("transcribe-audio-buffer", async (event, { data, filename }) => {
  // data: base64 string, filename: suggested like recording_<ts>.mp3
  const tmpDir = app.getPath("temp") || os.tmpdir();
  const filePath = path.join(tmpDir, filename || `rec_${Date.now()}.mp3`);

  try {
    // write file
    const buf = Buffer.from(data, "base64");
    fs.writeFileSync(filePath, buf);

    // call nodejs-whisper
    // using built-in model "small" and language autodetect
    const whisperOptions = {
      modelName: "small", // built-in gpt-style model name (small supports detectLanguage)
      detectLanguage: true,
      wordTimestamps: false,
    };

    const result = await nodewhisper(filePath, whisperOptions);

    // extract text and language if present
    const text = result?.text ?? "";
    const language =
      result?.language ||
      result?.detectedLanguage ||
      result?.lang ||
      result?.languageCode ||
      "unknown";

    // remove temporary file
    try {
      fs.unlinkSync(filePath);
    } catch (e) {
      // ignore cleanup errors
    }

    return { text, language };
  } catch (err) {
    // attempt cleanup
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (e) {}
    console.error("Transcription error:", err);
    throw err instanceof Error ? err.message : String(err);
  }
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
