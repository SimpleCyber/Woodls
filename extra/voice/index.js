// index.js
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { GlobalKeyboardListener } = require("node-global-key-listener");

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
    return JSON.parse(raw).hotkey || [];
  } catch (e) {
    return [];
  }
}

function saveSettings(keys) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ hotkey: keys }, null, 2));
}

function normalizeKeyName(k) {
  return String(k).toUpperCase();
}

function createWindow() {
  win = new BrowserWindow({
    width: 950,
    height: 750,
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
  keyboard = new GlobalKeyboardListener();

  keyboard.addListener((event) => {
    const key = normalizeKeyName(event.name);

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

ipcMain.on("save-hotkey", (e, keys) => {
  requiredKeys = keys.map(normalizeKeyName);
  saveSettings(requiredKeys);
  e.reply("hotkey-saved", requiredKeys);
});

ipcMain.on("clear-hotkey", (e) => {
  requiredKeys = [];
  saveSettings([]);
  e.reply("hotkey-cleared");
});

ipcMain.on("get-hotkey", (e) => {
  e.reply("hotkey-loaded", requiredKeys);
});

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
