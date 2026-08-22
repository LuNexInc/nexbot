// Bundle electron-updater into one self-contained CJS file for the packaged
// app. The shipped app has zero node_modules (asar `files` excludes them),
// so the updater cannot be require()d at runtime — it must ride along as a
// prebuilt bundle in electron/updater.bundle.cjs.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: [fileURLToPath(new URL("./updater-entry.cjs", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "cjs",
  external: ["electron"],
  outfile: fileURLToPath(new URL("../electron/updater.bundle.cjs", import.meta.url)),
  minify: true,
});
console.log("updater bundle written to electron/updater.bundle.cjs");
