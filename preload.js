const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  generateText: (args) => ipcRenderer.invoke("generate-text", args),
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
  autoType: (text) => ipcRenderer.invoke("auto-type", text),

  // Window Controls
  minimizeWindow: () => ipcRenderer.send("window-minimize"),
  maximizeWindow: () => ipcRenderer.send("window-maximize"),
  closeWindow: () => ipcRenderer.send("window-close"),

  // Overlay Controls
  showOverlay: () => ipcRenderer.send("show-overlay"),
  hideOverlay: () => ipcRenderer.send("hide-overlay"),
  sendMicVolume: (vol) => ipcRenderer.send("mic-volume", vol),
});
