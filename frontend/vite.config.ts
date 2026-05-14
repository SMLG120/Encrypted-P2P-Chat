import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_DEV_PROXY_TARGET || "http://localhost";
  const wsTarget = apiTarget.replace(/^http/, "ws");

  return {
    plugins: [react()],
    resolve: {
      alias: { "@": resolve(__dirname, "./src") },
    },
    server: {
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
        "/ws": { target: wsTarget, ws: true, changeOrigin: true },
      },
    },
  };
});
