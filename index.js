// main.js
const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const activeWin = require("active-win");
const { GlobalKeyboardListener } = require("node-global-key-listener");
const { GoogleGenerativeAI } = require("@google/generative-ai"); // keep as placeholder
const { GoogleAIFileManager } = require("@google/generative-ai/server");
const robot = require("@jitsi/robotjs");
const { initializeApp } = require("firebase/app");
const { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile } = require("firebase/auth");
const { getFirestore } = require("firebase/firestore");



// ---- CONFIG ----
require('dotenv').config();
const API_KEY = process.env.GEN_AI_API_KEY;
let genAI;
try {
  genAI = new GoogleGenerativeAI(API_KEY);
} catch (error) {
  console.error("Failed to initialize Google Generative AI:", error);
}

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


const SETTINGS_FILE = path.join(app.getPath("userData"), "settings.json");
const HISTORY_FILE = path.join(app.getPath("userData"), "history.json");
const RECORDINGS_DIR = path.join(app.getPath("userData"), "recordings");

// Ensure directories exist
if (!fs.existsSync(RECORDINGS_DIR)) {
    fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
}

let win;
let keyboard;
let requiredKeys = []; // single-key expected (array but we use index 0)
let running = false;
let pressStart = null;

// ----------------- helpers -----------------
function readSettings() {
  try {
    if (!fs.existsSync(SETTINGS_FILE)) return { hotkey: [] };
    const raw = fs.readFileSync(SETTINGS_FILE, "utf8");
    return JSON.parse(raw);
  } catch (e) {
    return { hotkey: [] };
  }
}

function saveSettings(newSettings) {
  try {
    const current = readSettings();
    const updated = { ...current, ...newSettings };
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  } catch (e) {
    console.error("Failed to save settings:", e);
  }
}

// Data Isolation State
let currentUser = null; // { uid, email, displayName, photoURL }

function getUserPaths() {
    const suffix = currentUser ? `_${currentUser.uid}` : "_guest";
    return {
        history: path.join(app.getPath("userData"), `history${suffix}.json`),
        notes: path.join(app.getPath("userData"), `notes${suffix}.json`)
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
      // Notify other windows if needed (e.g. overlay)
      // We do NOT need to send auth-state-changed back to main window since it initiated this.
      return { success: true };
  });

  ipcMain.handle("auth-logout", async () => {
      try {
          await signOut(auth); // Sign out of Main process auth if any
          currentUser = null;
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

  // Robustly load the file
  const indexPath = path.join(__dirname, "index.html");
  win.loadFile(indexPath).catch(e => console.error("Failed to load index.html:", e));

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
  try {
    const fileManager = new GoogleAIFileManager(API_KEY);

    // 1. Save to recordings folder for history
    const fileName = `rec_${Date.now()}.webm`;
    const savePath = path.join(RECORDINGS_DIR, fileName);
    const buffer = Buffer.from(arrayBuffer);
    fs.writeFileSync(savePath, buffer);

    // 2. Temp file for upload (or just use savePath)
    // We can use savePath directly since it's the same file
    
    // upload the audio
    const upload = await fileManager.uploadFile(savePath, {
      mimeType: "audio/webm",
      displayName: "hotkey-recording",
    });

    // now transcribe
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

    // Save to history (we'll update the refined text later if needed, or just save the transcript now)
    // Ideally we want the refined text too. The renderer calls generate-text separately.
    // Let's modify this to just return text, and renderer calls another IPC to "save complete history item" 
    // OR we save the transcript here, and update it later? 
    // Simpler: Just save transcript here. If we want refined, we can add a new IPC "add-history-item" called by renderer.
    // BUT user asked "Save audio and text to history".
    // Let's just save the transcript item here.
    
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
Return **only the refined text**, no explanations, no quotes, no markdown unless necessary.
**CRITICAL**: Do NOT include timestamps (e.g. (00:00), 01:23) or any video tracking metadata. Filter them out completely.

App: ${appName}
Text: "${info}"
`;
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const result = await model.generateContent(prompt);
    let txt = result.response.text();
    // Extra safety cleanup for hallucinations
    txt = txt.replace(/\(\d{2}:\d{2}\)/g, "").trim(); 
    return txt;
  } catch (err) {
    return "Error: " + (err && err.message ? err.message : String(err));
  }
});

// ----------------- app lifecycle -----------------
app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

