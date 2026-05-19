const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const apiUrl = trimTrailingSlash(
  import.meta.env.VITE_API_URL || "http://localhost:8000",
);

const wsUrl =
  import.meta.env.VITE_WS_URL ||
  `${apiUrl.replace(/^http/i, "ws")}/ws`;

export const config = {
  apiUrl,
  apiV1Url: `${apiUrl}/api/v1`,
  wsUrl,
  frontendOrigin: import.meta.env.VITE_FRONTEND_ORIGIN || window.location.origin,
};
