/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.tsx", "./src/**/*.{ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        // Marque Somafrik (aligné sur le web).
        brand: {
          DEFAULT: "#1d4ed8",
          50: "#eff6ff",
          100: "#dbeafe",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        ink: "#0f172a",
        muted: "#64748b",
        line: "#e2e8f0",
        canvas: "#f7f9fc",
        danger: "#dc2626",
        teal: "#0f766e",
      },
    },
  },
  plugins: [],
};
