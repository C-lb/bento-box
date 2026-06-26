import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#3b6cf6",
        canvas: "#0e0f12",
        surface: "#16181d",
        raised: "#1d2026",
        line: "#272b33",
        ink: "#e7e9ee",
        muted: "#9aa1ad",
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      fontSize: {
        base: ["13px", "1.5"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.25)",
        raisededge: "inset 0 1px 0 rgba(255,255,255,0.06)",
      },
      borderRadius: { card: "14px" },
    },
  },
  plugins: [],
} satisfies Config;
