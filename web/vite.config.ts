import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

const WEB_BASE = "/web/";

/** Redirige / et /web vers /web/ (base Vite exige le slash final). */
function webBaseRedirectPlugin(): Plugin {
  return {
    name: "web-base-redirect",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (path === "/" || path === "/web") {
          const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
          res.writeHead(302, { Location: `${WEB_BASE}${query}` });
          res.end();
          return;
        }
        next();
      });
    },
  };
}

// In dev, proxy /api to the Express backend so the BackOffice behaves
// exactly like in production (same-origin /api calls, JWT in Authorization).
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");

  return {
    plugins: [webBaseRedirectPlugin(), react()],
    base: WEB_BASE,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
      },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_API_TARGET || "http://127.0.0.1:5000",
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: false,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes("node_modules")) return;

            if (id.includes("react-router")) return "router";
            if (
              id.includes("react-dom") ||
              id.includes("/react/") ||
              id.includes("scheduler")
            ) {
              return "react";
            }

            if (id.includes("grapesjs")) return "vendor-grapesjs";
            if (id.includes("recharts") || id.includes("/d3-")) return "vendor-recharts";
            if (id.includes("framer-motion")) return "vendor-motion";
            if (id.includes("@tanstack/react-table")) return "vendor-table";
            if (id.includes("@radix-ui")) return "vendor-radix";
            if (id.includes("lucide-react")) return "vendor-icons";
            if (id.includes("date-fns")) return "vendor-date-fns";
            if (id.includes("zod") || id.includes("@hookform")) return "vendor-forms";
          },
        },
      },
    },
  };
});
