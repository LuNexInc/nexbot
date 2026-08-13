// Renderer bridge. contextIsolation stays on; the renderer only ever sees
// this narrow surface (window.nexbot), never Node or ipcRenderer itself.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nexbot", {
  platform: process.platform,
  /** True when the Swift SFSpeech helper is used (macOS). Else Web Speech. */
  speechNative: process.platform === "darwin",
  /** One frame of the local screen as a data: URL. */
  screenFrame: () => ipcRenderer.invoke("screen:frame"),
  speechStart: () => ipcRenderer.invoke("speech:start"),
  speechStop: () => ipcRenderer.invoke("speech:stop"),
  onSpeechTranscript: (cb) => {
    const handler = (_event, line) => cb(line);
    ipcRenderer.on("speech:transcript", handler);
    return () => ipcRenderer.removeListener("speech:transcript", handler);
  },
  onSpeechEnd: (cb) => {
    const handler = (_event, info) => cb(info);
    ipcRenderer.on("speech:end", handler);
    return () => ipcRenderer.removeListener("speech:end", handler);
  },
  permStatus: () => ipcRenderer.invoke("perm:status"),
  permRequestMic: () => ipcRenderer.invoke("perm:request-mic"),
  permOpenSettings: (pane) => ipcRenderer.invoke("perm:open-settings", pane),
  /** Local CUA computer-use status (binary + connection mode). */
  cuaConnection: () => ipcRenderer.invoke("cua:connection"),
  cuaPermissions: () => ipcRenderer.invoke("cua:permissions"),
  cuaBinary: () => ipcRenderer.invoke("cua:binary"),
  capabilities: () => ipcRenderer.invoke("desktop:capabilities"),
  openWatch: (botId) => ipcRenderer.invoke("watch:open", botId || ""),
  notify: (title, body) => ipcRenderer.invoke("notify", title, body),
  openPath: (dir) => ipcRenderer.invoke("open-path", dir),
  autostartStatus: () => ipcRenderer.invoke("autostart:status"),
  autostartSet: (on) => ipcRenderer.invoke("autostart:set", on),
});
