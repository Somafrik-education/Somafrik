/** @type {import("@expo/config").ExpoConfig} */
const fs = require("fs");
const path = require("path");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const mobileRoot = __dirname;
const workspaceRoot = path.join(mobileRoot, "..");
loadEnvFile(path.join(workspaceRoot, ".env"));
loadEnvFile(path.join(mobileRoot, ".env.local"));

module.exports = ({ config }) => {
  const apiUrl = String(process.env.EXPO_PUBLIC_API_URL ?? "").replace(/\/$/, "");
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
  const isProdProfile =
    process.env.EAS_BUILD_PROFILE === "production" ||
    process.env.APP_ENV === "production" ||
    process.env.NODE_ENV === "production";

  if (isProdProfile && apiUrl && !apiUrl.startsWith("https://")) {
    throw new Error("S2.3 — EXPO_PUBLIC_API_URL doit être HTTPS en production.");
  }
  if (isProdProfile && demoMode) {
    throw new Error("EXPO_PUBLIC_DEMO_MODE interdit en production.");
  }

  return {
    ...config,
    name: "Somafrik",
    slug: "somafrik",
    scheme: "somafrik",
    userInterfaceStyle: "light",
    extra: {
      ...config.extra,
      apiUrl: apiUrl || (isProdProfile ? "" : "http://localhost:5000"),
      demoMode: isProdProfile ? false : demoMode,
      certificatePinningReady: true,
    },
    ios: {
      ...config.ios,
      bundleIdentifier: "com.somafrik.app",
      supportsTablet: true,
    },
    android: {
      ...config.android,
      package: "com.somafrik.app",
      // S2.3 — cleartext HTTP uniquement hors production (dev LAN / émulateur).
      usesCleartextTraffic: !isProdProfile,
    },
    plugins: [
      ...(config.plugins ?? []),
      "expo-secure-store",
    ],
  };
};
