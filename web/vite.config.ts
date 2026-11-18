import { execFileSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import {
  assertAllowedDeployBranch,
  buildInfoJson,
  buildShaMetaTag,
  resolveBuildProvenance,
} from "./src/lib/buildProvenance";

function readLocalGit(args: string[]): string | null {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * LOT 5 — publie la provenance du build (build-info.json + meta) et applique le garde-fou
 * de branche (opt-in via SOMAFRIK_ALLOWED_DEPLOY_BRANCHES). Actif uniquement en `vite build`.
 */
function buildProvenancePlugin(env: Record<string, string | undefined>): Plugin {
  const provenance = resolveBuildProvenance(env, {
    sha: readLocalGit(["rev-parse", "HEAD"]),
    branch: readLocalGit(["rev-parse", "--abbrev-ref", "HEAD"]),
  });
  return {
    name: "somafrik-build-provenance",
    apply: "build",
    buildStart() {
      assertAllowedDeployBranch(env, provenance);
    },
    transformIndexHtml(html) {
      return html.replace("</head>", `    ${buildShaMetaTag(provenance)}\n  </head>`);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "build-info.json", source: buildInfoJson(provenance) });
    },
  };
}

function normalizeBasePath(value: string | undefined): string {
  const raw = String(value ?? "/").trim() || "/";
  if (raw === "/") return "/";
  return raw.endsWith("/") ? raw : `${raw}/`;
}

/** Redirige vers la base Vite (slash final requis). */
function webBaseRedirectPlugin(basePath: string): Plugin {
  const legacyBase = "/web/";
  return {
    name: "web-base-redirect",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        const query = req.url?.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";

        if (path.startsWith("/verify/rc")) {
          req.url = `${basePath}${query}`;
          next();
          return;
        }

        if (basePath !== "/" && (path === "/" || path === basePath.slice(0, -1))) {
          res.writeHead(302, { Location: `${basePath}${query}` });
          res.end();
          return;
        }

        if (basePath === "/" && (path === legacyBase.slice(0, -1) || path === legacyBase.slice(0, -1) + "/")) {
          res.writeHead(302, { Location: `/${query}` });
          res.end();
          return;
        }

        if (basePath === "/" && path.startsWith("/web/")) {
          res.writeHead(302, { Location: `${path.slice(4)}${query}` });
          res.end();
          return;
        }

        next();
      });
    },
  };
}

// En dev, proxy /api vers Express. En prod Vercel, VITE_API_URL pointe vers api.*.somafrik.app.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const basePath = normalizeBasePath(env.VITE_BASE_PATH);

  return {
    plugins: [webBaseRedirectPlugin(basePath), react(), buildProvenancePlugin({ ...process.env, ...env })],
    base: basePath,
    resolve: {
      alias: {
        "@": fileURLToPath(new URL("./src", import.meta.url)),
        "@somafrik/help-catalog": fileURLToPath(
          new URL("../packages/help-catalog/src/index.js", import.meta.url),
        ),
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
            // Uniquement le package catalogue. Ne pas y coller web/src/help :
            // HelpHost importe AuthContext/cn, et un chunk partagé ferait
            // télécharger le catalogue depuis la vitrine et /connexion.
            if (id.includes("packages/help-catalog")) {
              return "help-catalog";
            }
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
