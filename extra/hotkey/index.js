// index.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { GlobalKeyboardListener } = require("node-global-key-listener");

const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");

let win;
let keyboard;
let requiredKeys = []; // e.g. ["CONTROL","SHIFT","A"]
let currentPressed = new Set();
let running = false;
let pressStart = null;

function readSettings() {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    const s = JSON.parse(raw);
    if (Array.isArray(s.hotkey)) return s.hotkey;
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

function normalizeKeyName(raw) {
  if (!raw) return "";
  // Normalize common names and uppercase
  return String(raw).toUpperCase();
}

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

  // load saved hotkey
  requiredKeys = readSettings();
  win.webContents.on("did-finish-load", () => {
    win.webContents.send("hotkey-loaded", requiredKeys);
  });

  setupGlobalListener();
}

function setupGlobalListener() {
  if (keyboard) {
    // already running
    return;
  }
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener((event) => {
    // event example: {state: "DOWN"|"UP", name: "A"|"SHIFT"|...}
    const name = normalizeKeyName(event.name);

    if (event.state === "DOWN") {
      currentPressed.add(name);
      // check if all required keys are present (strict: all at same time)
      if (!running && requiredKeys.length > 0) {
        const allPresent = requiredKeys.every((k) => currentPressed.has(k));
        if (allPresent) {
          running = true;
          pressStart = Date.now();
          win.webContents.send("hotkey-pressed", {
            keys: requiredKeys,
            time: pressStart,
          });
        }
      }
    } else if (event.state === "UP") {
      // If any of required keys are released while running -> stop
      // remove from set first
      currentPressed.delete(name);

      if (running) {
        // If the released key is one of required, stop timer
        const releasedIsRequired = requiredKeys.includes(name);
        if (releasedIsRequired) {
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
    }
  });
}

// IPC: Save new hotkey (array of names)
ipcMain.on("save-hotkey", (event, keys) => {
  const normalized = (keys || []).map(normalizeKeyName);
  requiredKeys = normalized;
  saveSettings(normalized);
  event.reply("hotkey-saved", normalized);
});

// IPC: Clear hotkey
ipcMain.on("clear-hotkey", (event) => {
  requiredKeys = [];
  saveSettings([]);
  event.reply("hotkey-cleared");
});

// IPC: get current hotkey
ipcMain.on("get-hotkey", (event) => {
  event.reply("hotkey-loaded", requiredKeys);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
