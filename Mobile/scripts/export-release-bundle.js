/**
 * Exporte un bundle Android Metro minify pour un profil LOT 7.
 * Usage: node scripts/export-release-bundle.js <preview|preproduction|production>
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  CANONICAL_API_URLS,
  HTTPS_ONLY_PROFILES,
} = require("../config/releaseEnvironments");

const MOBILE = path.join(__dirname, "..");
const profile = process.argv[2];

if (!HTTPS_ONLY_PROFILES.includes(profile)) {
  console.error("Profil requis: preview | preproduction | production");
  process.exit(1);
}

const apiUrl = CANONICAL_API_URLS[profile];
process.env.EXPO_PUBLIC_RELEASE_PROFILE = profile;
process.env.EAS_BUILD_PROFILE = profile;
process.env.EXPO_PUBLIC_API_URL = apiUrl;
if (profile === "preview") process.env.EXPO_PUBLIC_API_URL_PREVIEW = apiUrl;
if (profile === "preproduction") process.env.EXPO_PUBLIC_API_URL_PREPRODUCTION = apiUrl;
if (profile === "production") process.env.EXPO_PUBLIC_API_URL_PRODUCTION = apiUrl;
process.env.EXPO_PUBLIC_DEMO_MODE = "false";
process.env.EXPO_PUBLIC_DEMO_PIN = "";
process.env.NODE_ENV = "production";

async function main() {
  const Metro = require(path.join(MOBILE, "node_modules", "metro"));
  const { loadConfig } = require(path.join(MOBILE, "node_modules", "metro-config"));
  for (const cacheDir of [
    path.join(MOBILE, "node_modules", ".cache", "metro"),
    path.join(MOBILE, ".expo", "metro"),
  ]) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
  }
  const outDir = process.env.SOMAFRIK_BUNDLE_OUT
    || fs.mkdtempSync(path.join(os.tmpdir(), `somafrik-${profile}-bundle-`));
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `index.android.${profile}.js`);
  const config = await loadConfig({ cwd: MOBILE, resetCache: true });
  config.resetCache = true;
  await Metro.runBuild(config, {
    entry: path.join(MOBILE, "node_modules", "expo", "AppEntry.js"),
    platform: "android",
    dev: false,
    minify: true,
    out: outFile,
    sourceMap: false,
  });
  const bundleFile = fs.existsSync(outFile) ? outFile : `${outFile}.js`;
  const marker = path.join(outDir, "bundle-path.txt");
  fs.writeFileSync(marker, bundleFile);
  console.log(bundleFile);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
