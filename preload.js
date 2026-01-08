const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // History
  getHistory: () => ipcRenderer.invoke("get-history"),
  deleteHistoryItem: (id) => ipcRenderer.invoke("delete-history-item", id),
  updateHistoryItem: (data) => ipcRenderer.invoke("update-history-item", data),
  readAudioFile: (path) => ipcRenderer.invoke("read-audio-file", path),

  // Input
  sendBackspace: () => ipcRenderer.invoke("send-backspace"),
  pasteString: (text) => ipcRenderer.invoke("paste-string", text),
  autoType: (text) => ipcRenderer.invoke("auto-type", text),
  
  // Overlay Processing States
  processingStart: () => ipcRenderer.send("processing-start"),
  processingEnd: () => ipcRenderer.send("processing-end"),
  
  // Settings
  saveSetting: (k, v) => ipcRenderer.send("save-setting", { key: k, value: v }),
  onSettingsLoaded: (cb) => ipcRenderer.on("settings-loaded", cb),
  
  // Startup
  setStartupSettings: (settings) => ipcRenderer.send("set-startup-settings", settings),
  getStartupSettings: () => ipcRenderer.send("get-startup-settings"),
  onStartupSettingsLoaded: (cb) => ipcRenderer.on("startup-settings-loaded", cb),

  // LLM
  generateText: (data) => ipcRenderer.invoke("generate-text", data),
  onActiveWindow: (cb) => ipcRenderer.on("active-window", cb),

  // Hotkeys
  saveHotkey: (keys) => ipcRenderer.send("save-hotkey", keys),
  clearHotkey: () => ipcRenderer.send("clear-hotkey"),
  getHotkey: () => ipcRenderer.send("get-hotkey"),
  onHotkeyLoaded: (cb) => ipcRenderer.on("hotkey-loaded", cb),
  onHotkeySaved: (cb) => ipcRenderer.on("hotkey-saved", cb),
  onHotkeyCleared: (cb) => ipcRenderer.on("hotkey-cleared", cb),

  // Recording events from main
  onRecordStart: (cb) => ipcRenderer.on("record-start", cb),
  onRecordStop: (cb) => ipcRenderer.on("record-stop", cb),
  onHotkeyPressed: (cb) => ipcRenderer.on("hotkey-pressed", cb),
  onHotkeyReleased: (cb) => ipcRenderer.on("hotkey-released", cb),

  // Saving audio
  saveAudio: (buffer) => ipcRenderer.send("save-audio", buffer),
  onSaveComplete: (cb) => ipcRenderer.on("save-complete", cb),

  // Speech to text
  transcribeAudio: (buffer) => ipcRenderer.invoke("transcribe-audio", buffer),
  
  // Auto type


  // Notes
  getNotes: () => ipcRenderer.invoke("get-notes"),
  saveNote: (note) => ipcRenderer.invoke("save-note", note),
  deleteNote: (id) => ipcRenderer.invoke("delete-note", id),
  getAIInfo: () => ipcRenderer.invoke("get-ai-info"),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),

  // Overlay Controls
  showOverlay: (...args) => ipcRenderer.send("show-overlay", ...args),
  hideOverlay: () => ipcRenderer.send("hide-overlay"),
  sendMicVolume: (vol) => ipcRenderer.send("mic-volume", vol),

  // Auth
  login: (creds) => ipcRenderer.invoke("auth-login", creds),
  authSync: (user) => ipcRenderer.invoke("auth-sync-user", user), // New Sync Method
  signup: (creds) => ipcRenderer.invoke("auth-signup", creds),
  logout: () => ipcRenderer.invoke("auth-logout"),
  getCurrentUser: () => ipcRenderer.invoke("auth-get-current"),
  onAuthStateChanged: (cb) => ipcRenderer.on("auth-state-changed", cb),
  onAIInfoUpdate: (cb) => ipcRenderer.on("ai-info-update", (event, ...args) => cb(...args)),
});
