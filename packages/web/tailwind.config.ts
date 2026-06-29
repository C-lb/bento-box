import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        accent: "#3b6cf6",
        canvas: "#f5f6f8",
        surface: "#ffffff",
        raised: "#ffffff",
        line: "#e4e7ec",
        ink: "#1a1d23",
        muted: "#5f6b7a",
        success: "#16a34a",
        danger: "#b42318",
      },
      fontFamily: {
        sans: ["DM Sans", "system-ui", "sans-serif"],
      },
      fontSize: {
        base: ["13px", "1.5"],
      },
      boxShadow: {
        soft: "0 1px 2px rgba(16,24,40,0.06), 0 8px 24px rgba(16,24,40,0.08)",
        raisededge: "inset 0 1px 0 rgba(255,255,255,0.7), 0 1px 1px rgba(16,24,40,0.04)",
      },
      borderRadius: { card: "14px" },
    },
  },
  plugins: [],
} satisfies Config;
