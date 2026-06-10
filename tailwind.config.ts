import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      fontFamily: {
        sans: ["SF Pro Display", "PingFang SC", "Hiragino Sans GB", "sans-serif"],
        mono: ["SF Mono", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
