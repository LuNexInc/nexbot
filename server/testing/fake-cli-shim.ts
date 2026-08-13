// Build a Windows-safe CLI shim that runs a Node script with the same
// argv the real agent CLI would receive. On Unix, the shebang script path
// is enough; on Windows, spawn needs .cmd or node + script.
import { writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

/** Returns a path you can pass as `config.cli` on any platform. */
export function fakeCliShim(scriptPath: string, tempDir: string, name = "fake-cli"): string {
  if (process.platform !== "win32") {
    try {
      chmodSync(scriptPath, 0o755);
    } catch {
      /* may already be executable */
    }
    return scriptPath;
  }
  const shim = join(tempDir, `${name}.cmd`);
  // %* forwards all args; quote node + script for spaces in paths.
  const body = `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`;
  writeFileSync(shim, body, "utf8");
  return shim;
}
