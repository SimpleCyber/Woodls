// preload.js
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // LLM
  generateText: (payload) => ipcRenderer.invoke("generate-text", payload),

  // Hotkey config
  saveHotkey: (keys) => ipcRenderer.send("save-hotkey", keys),
  clearHotkey: () => ipcRenderer.send("clear-hotkey"),
  getHotkey: () => ipcRenderer.send("get-hotkey"),

  // Events for hotkey lifecycle
  onHotkeySaved: (cb) => ipcRenderer.on("hotkey-saved", cb),
  onHotkeyLoaded: (cb) => ipcRenderer.on("hotkey-loaded", cb),
  onHotkeyCleared: (cb) => ipcRenderer.on("hotkey-cleared", cb),
  onHotkeyPressed: (cb) => ipcRenderer.on("hotkey-pressed", cb),
  onHotkeyReleased: (cb) => ipcRenderer.on("hotkey-released", cb),

  // Record start/stop events from main
  onRecordStart: (cb) => ipcRenderer.on("record-start", cb),
  onRecordStop: (cb) => ipcRenderer.on("record-stop", cb),

  // Active window updates
  onActiveWindow: (cb) => ipcRenderer.on("active-window", cb),

  // audio to text
  transcribeAudio: (arrayBuffer) => ipcRenderer.invoke("transcribe-audio", arrayBuffer),

  // auto type
  autoType: (text) => ipcRenderer.invoke("auto-type", text),



  // Save recorded audio (send ArrayBuffer)
  saveAudio: (arrayBuffer) => ipcRenderer.send("save-audio", arrayBuffer),
  onSaveComplete: (cb) => ipcRenderer.on("save-complete", cb),
});
