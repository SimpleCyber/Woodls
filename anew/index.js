const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const activeWin = require("active-win");
const mic = require("mic");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

let win;
let keyboard;
let requiredKeys = [];
let currentPressed = new Set();
let running = false;
let pressStart = null;

// MIC recording variables
let micInstance = null;
let micInputStream = null;
let audioWriteStream = null;
let audioFilePath = null;

// Load saved hotkey
function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const s = JSON.parse(raw);
    if (Array.isArray(s.hotkey)) return s.hotkey;
  } catch (e) {}
  return [];
}

// Save hotkey
function saveSettings(keys) {
  fs.writeFileSync(
    SETTINGS_FILE,
    JSON.stringify({ hotkey: keys }, null, 2)
  );
}

function normalizeKeyName(raw) {
  return String(raw).toUpperCase();
}

// Create window
function createWindow() {
  win = new BrowserWindow({
    width: 900,
    height: 700,
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

// 🎤 Start recording
function startRecording() {
  const timestamp = Date.now();
  audioFilePath = path.join(__dirname, `voiceRecorded_${timestamp}.wav`);

  micInstance = mic({
    rate: "16000",
    channels: "1",
    debug: false,
    fileType: "wav",
  });

  micInputStream = micInstance.getAudioStream();
  audioWriteStream = fs.createWriteStream(audioFilePath);

  micInputStream.pipe(audioWriteStream);

  micInputStream.on("error", (err) => {
    console.log("MIC ERROR:", err);
  });

  micInstance.start();
  console.log("🎤 Recording started:", audioFilePath);

  win.webContents.send("recording-started", { file: audioFilePath });
}

// 🎤 Stop recording
function stopRecording() {
  if (!micInstance) return;

  micInstance.stop();

  console.log("🎤 Recording stopped:", audioFilePath);

  win.webContents.send("recording-stopped", { file: audioFilePath });

  micInstance = null;
  micInputStream = null;
  audioWriteStream = null;
}

// GLOBAL HOTKEY DETECT
function setupGlobalListener() {
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener(async (event) => {
    const name = normalizeKeyName(event.name);

    if (event.state === "DOWN") {
      currentPressed.add(name);

      const allPresent = requiredKeys.every((k) =>
        currentPressed.has(k)
      );

      if (!running && requiredKeys.length > 0 && allPresent) {
        running = true;
        pressStart = Date.now();

        // Get active window
        const info = await activeWin();

        win.webContents.send("hotkey-pressed", {
          keys: requiredKeys,
          time: pressStart,
          window: info,
        });

        // Start recording 🎤
        startRecording();
      }
    }

    if (event.state === "UP") {
      currentPressed.delete(name);

      if (running && requiredKeys.includes(name)) {
        const releaseTime = Date.now();
        const duration = releaseTime - pressStart;

        running = false;
        pressStart = null;

        win.webContents.send("hotkey-released", {
          keys: requiredKeys,
          releaseTime,
          duration,
        });

        // Stop recording 🎤
        stopRecording();
      }
    }
  });
}

// IPC
ipcMain.on("save-hotkey", (event, keys) => {
  requiredKeys = keys.map(normalizeKeyName);
  saveSettings(requiredKeys);
  event.reply("hotkey-saved", requiredKeys);
});

ipcMain.on("clear-hotkey", (event) => {
  requiredKeys = [];
  saveSettings([]);
  event.reply("hotkey-cleared");
});

ipcMain.on("get-hotkey", (event) => {
  event.reply("hotkey-loaded", requiredKeys);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
