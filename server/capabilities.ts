// Honest desktop capability snapshot. Do not infer CUA from process.platform.

export type DesktopCapabilities = {
  host: {
    platform: "darwin" | "linux" | "win32" | "browser";
    label: string;
    packaged: boolean;
  };
  screenPreview: { available: boolean; reasonCode?: string };
  dictation: { available: boolean; engine: "apple-speech" | "web-speech" | "none"; reasonCode?: string };
  localComputer: {
    available: boolean;
    support: "supported" | "limited" | "unsupported";
    reasonCode?: string;
  };
};

export function hostPlatform(): DesktopCapabilities["host"]["platform"] {
  if (process.platform === "darwin" || process.platform === "linux" || process.platform === "win32") {
    return process.platform;
  }
  return "browser";
}

export function detectCapabilities(input?: {
  cuaReady?: boolean;
  electron?: boolean;
  packaged?: boolean;
}): DesktopCapabilities {
  const platform = hostPlatform();
  const electron = Boolean(input?.electron);
  const cuaReady = Boolean(input?.cuaReady);
  const packaged = Boolean(input?.packaged);
  const labels: Record<DesktopCapabilities["host"]["platform"], string> = {
    darwin: "macOS",
    linux: "Linux",
    win32: "Windows",
    browser: "Browser",
  };
  return {
    host: { platform, label: labels[platform], packaged },
    screenPreview: electron
      ? { available: true }
      : { available: false, reasonCode: "needs-desktop-app" },
    dictation: electron
      ? {
          available: true,
          engine: platform === "darwin" ? "apple-speech" : "web-speech",
        }
      : { available: false, engine: "none", reasonCode: "needs-desktop-app" },
    localComputer: cuaReady
      ? { available: true, support: "supported" }
      : {
          available: false,
          support: "unsupported",
          reasonCode: electron ? "cua-driver-missing" : "needs-desktop-app",
        },
  };
}
