const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_API_URL;
  if (configured === undefined || configured === "") {
    if (typeof window !== "undefined") {
      return trimTrailingSlash(window.location.origin);
    }
    return "http://localhost:8000";
  }
  return trimTrailingSlash(configured);
}

function resolveWsUrl(apiUrl: string): string {
  const configured = import.meta.env.VITE_WS_URL;
  if (configured) return configured;

  if (typeof window !== "undefined" && (!import.meta.env.VITE_API_URL || import.meta.env.VITE_API_URL === "")) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws`;
  }

  return `${apiUrl.replace(/^http/i, "ws")}/ws`;
}

const apiUrl = resolveApiUrl();
const wsUrl = resolveWsUrl(apiUrl);

export const config = {
  apiUrl,
  apiV1Url: `${apiUrl}/api/v1`,
  wsUrl,
  frontendOrigin: import.meta.env.VITE_FRONTEND_ORIGIN || (typeof window !== "undefined" ? window.location.origin : "http://localhost:5173"),
};
