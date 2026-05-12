import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#040508",
        surface: "#0a0d14",
        panel: "#0f1420",
        border: "#1a2035",
        "border-bright": "#2a3555",
        cyan: {
          DEFAULT: "#00d4ff",
          dim: "#0099cc",
          glow: "#00d4ff40",
        },
        emerald: {
          DEFAULT: "#00ff88",
          dim: "#00cc6a",
          glow: "#00ff8840",
        },
        amber: {
          DEFAULT: "#ffb800",
          dim: "#cc9200",
        },
        rose: {
          DEFAULT: "#ff3366",
          dim: "#cc2952",
        },
        text: {
          primary: "#e8eaf0",
          secondary: "#8892aa",
          muted: "#4a5568",
        },
      },
      fontFamily: {
        mono: ["'JetBrains Mono'", "'Fira Code'", "monospace"],
        display: ["'Space Grotesk'", "sans-serif"],
        body: ["'Inter'", "sans-serif"],
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(0,212,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(0,212,255,0.03) 1px, transparent 1px)",
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
      },
      backgroundSize: {
        grid: "40px 40px",
      },
      animation: {
        "pulse-cyan": "pulse-cyan 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "scan-line": "scan-line 4s linear infinite",
        "glow-pulse": "glow-pulse 3s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
      keyframes: {
        "pulse-cyan": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.4" },
        },
        "scan-line": {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100vh)" },
        },
        "glow-pulse": {
          "0%, 100%": { boxShadow: "0 0 20px rgba(0,212,255,0.3)" },
          "50%": { boxShadow: "0 0 40px rgba(0,212,255,0.6)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      boxShadow: {
        "cyan-glow": "0 0 20px rgba(0,212,255,0.4)",
        "emerald-glow": "0 0 20px rgba(0,255,136,0.4)",
        "panel": "0 4px 24px rgba(0,0,0,0.6), 0 0 0 1px rgba(26,32,53,1)",
        "panel-hover": "0 8px 32px rgba(0,0,0,0.8), 0 0 0 1px rgba(42,53,85,1)",
      },
    },
  },
  plugins: [],
} satisfies Config;
