import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{vue,ts}"],
  theme: {
    extend: {
      colors: {
        ink: "#172033",
        muted: "#637083",
        panel: "#ffffff",
        line: "#d9e0ea",
        brand: "#2166c2",
        success: "#16805f",
        warning: "#bd6b12",
        danger: "#c2414b"
      },
      boxShadow: {
        panel: "0 10px 28px rgba(24, 35, 57, 0.08)"
      }
    }
  },
  plugins: []
} satisfies Config;
