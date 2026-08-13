// Small HTTP helpers shared by the harness server.
import type { IncomingMessage, ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

export const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

export function json(res: ServerResponse, status: number, body: unknown) {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

export function readBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

/** Serve a static file from `staticDir`, with SPA fallback to index.html. */
export function serveStatic(
  res: ServerResponse,
  staticDir: string,
  urlPath: string,
): boolean {
  const safe = urlPath === "/" ? "/index.html" : urlPath.replace(/\.\./g, "");
  const file = join(staticDir, safe);
  try {
    if (!existsSync(file)) throw new Error("missing");
    const data = readFileSync(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    res.end(data);
    return true;
  } catch {
    try {
      const data = readFileSync(join(staticDir, "index.html"));
      res.writeHead(200, { "content-type": "text/html" });
      res.end(data);
      return true;
    } catch {
      return false;
    }
  }
}

/** Clear hint when the source harness cannot bind its port. */
export function portBusyHint(port: number): string {
  return [
    "Port " + port + " is already in use (EADDRINUSE).",
    "The installed NexBot tray (0.3.8) is likely holding :8799 — quit that app first (tray → Quit), then retry.",
    "Vite :5199 is UI only.",
  ].join("\n");
}
