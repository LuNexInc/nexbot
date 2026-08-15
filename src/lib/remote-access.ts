const TOKEN_KEY = "nexbot.remote.token";

let memoryToken = "";
let installed = false;

function readStoredToken(): string {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = window.localStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    try {
      memoryToken = window.sessionStorage.getItem(TOKEN_KEY) ?? "";
    } catch {
      memoryToken = "";
    }
  }
  return memoryToken;
}

function saveToken(token: string): void {
  memoryToken = token;
  try {
    window.localStorage.setItem(TOKEN_KEY, token);
  } catch {
    try {
      window.sessionStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Private browsing can block both storage APIs. The in-memory token still works.
    }
  }
}

function tokenFromHash(): string {
  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return "";
  const params = new URLSearchParams(hash);
  return params.get("token") ?? params.get("access") ?? "";
}

function withRemoteToken(input: string | URL): string {
  const url = new URL(input.toString(), window.location.href);
  const token = readStoredToken();
  if (!token || url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
    return url.toString();
  }
  url.searchParams.set("token", token);
  return url.toString();
}

/** Return an API URL with the device's pairing token for EventSource and links. */
export function remoteApiUrl(path: string): string {
  return withRemoteToken(path);
}

/**
 * Capture a pairing token from the one-time hash link, then add the token to
 * same-origin API calls. The hash is removed from the address bar after it is
 * saved so links and screenshots do not expose the token.
 */
export function installRemoteAccess(): void {
  if (installed) return;
  installed = true;

  const incoming = tokenFromHash();
  if (incoming) {
    saveToken(incoming);
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  } else {
    readStoredToken();
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const token = readStoredToken();
    if (!token) return originalFetch(input, init);

    const rawUrl = input instanceof Request ? input.url : input instanceof URL ? input.href : input;
    const url = new URL(rawUrl, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) {
      return originalFetch(input, init);
    }
    url.searchParams.set("token", token);
    if (input instanceof Request) {
      return originalFetch(new Request(url.toString(), input), init);
    }
    return originalFetch(url.toString(), init);
  };
}
