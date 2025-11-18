const { app, BrowserWindow, ipcMain } = require("electron");
const activeWin = require("active-win");

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile("index.html");

  // Send active window info every second
  setInterval(async () => {
    const info = await activeWin();
    win.webContents.send("active-window", info);
  }, 1000);
}

app.whenReady().then(createWindow);
