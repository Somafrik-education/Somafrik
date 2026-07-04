import tailwindcssAnimate from "tailwindcss-animate";

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Design tokens repris du BackOffice historique
        ink: "#0f172a",
        // `muted` conserve la couleur de texte historique (text-muted) tout en
        // exposant `muted-foreground` pour les composants shadcn/ui.
        muted: {
          DEFAULT: "#64748b",
          foreground: "hsl(var(--muted-foreground))",
        },
        line: "#e2e8f0",
        brand: {
          DEFAULT: "#1d4ed8",
          50: "#eff6ff",
          100: "#dbeafe",
          600: "#1d4ed8",
          700: "#1e40af",
        },
        teal: "#0f766e",
        amber: "#b45309",
        danger: "#dc2626",
        canvas: "#f7f9fc",
        // Tokens shadcn/ui (pilotés par variables CSS, voir index.css)
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
      },
      boxShadow: {
        card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 8px 24px rgba(15, 23, 42, 0.06)",
        brand: "0 20px 40px -18px rgba(37, 99, 235, 0.55)",
        lift: "0 24px 50px -24px rgba(15, 23, 42, 0.3)",
      },
      backgroundImage: {
        "brand-gradient": "linear-gradient(135deg, #2563eb 0%, #1d4ed8 52%, #1e3a8a 100%)",
      },
      keyframes: {
        blob: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "33%": { transform: "translate(24px, -28px) scale(1.08)" },
          "66%": { transform: "translate(-18px, 16px) scale(0.95)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        blob: "blob 14s ease-in-out infinite",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
