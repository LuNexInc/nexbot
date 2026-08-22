// Vitest setup — every test file gets a throwaway home directory so
// DATA_DIR (~/.nexbot) never touches the real one. os.homedir()
// reads HOME (POSIX) / USERPROFILE (Windows) at call time, and this file
// runs before any test module imports server/config.ts.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach } from "vitest";

const home = mkdtempSync(join(tmpdir(), "nexbot-test-home-"));
process.env.HOME = home;
process.env.USERPROFILE = home;

afterEach(async () => {
  try {
    const { closeStoreDb } = await import("../db.ts");
    closeStoreDb();
  } catch {
    /* db unused in this file */
  }
});

afterAll(() => {
  try {
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // Windows can leave locks on temp dirs after named-pipe / child exits.
  }
});
