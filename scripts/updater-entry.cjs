// esbuild entry: expose the autoUpdater singleton only.
const { autoUpdater } = require("electron-updater");
module.exports = { autoUpdater };
