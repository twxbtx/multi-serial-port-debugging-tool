const { contextBridge, ipcRenderer } = require("electron");

const serialApi = {
  listPorts: () => ipcRenderer.invoke("serial:listPorts"),
  connectSession: (request) => ipcRenderer.invoke("serial:connect", request),
  disconnectSession: (sessionId) => ipcRenderer.invoke("serial:disconnect", sessionId),
  writeData: (request) => ipcRenderer.invoke("serial:write", request),
  openTextFile: () => ipcRenderer.invoke("dialog:openTextFile"),
  saveExport: (request) => ipcRenderer.invoke("dialog:saveExport", request),
  saveCachedLog: (request) => ipcRenderer.invoke("dialog:saveCachedLog", request),
  getLogCacheStatus: (sessionId) => ipcRenderer.invoke("logCache:getStatus", sessionId),
  clearLogCache: (sessionId) => ipcRenderer.invoke("logCache:clear", sessionId),
  chooseBinaryFile: () => ipcRenderer.invoke("dialog:chooseBinaryFile"),
  sendFile: (request) => ipcRenderer.invoke("serial:sendFile", request),
  setAlwaysOnTop: (nextState) => ipcRenderer.invoke("window:setAlwaysOnTop", nextState),
  getWindowState: () => ipcRenderer.invoke("window:getState"),
  minimizeWindow: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggleMaximize"),
  closeWindow: () => ipcRenderer.invoke("window:close"),
  loadSavedState: () => ipcRenderer.invoke("settings:load"),
  saveSavedState: (state) => ipcRenderer.invoke("settings:save", state),
  onSessionEvent: (callback) => {
    const handler = (_, payload) => callback(payload);
    ipcRenderer.on("serial:event", handler);
    return () => ipcRenderer.removeListener("serial:event", handler);
  },
};

contextBridge.exposeInMainWorld("serialApi", serialApi);
