const fs = require("fs");
const path = require("path");
const os = require("os");

const mobileRoot = path.join(__dirname, "..");
const workspaceRoot = path.join(mobileRoot, "..");
const androidDir = path.join(mobileRoot, "android");
const localPropertiesPath = path.join(androidDir, "local.properties");

const DEFAULT_JAVA_HOME =
  process.platform === "win32"
    ? path.join(
        os.homedir(),
        "AppData",
        "Local",
        "Programs",
        "Eclipse Adoptium",
        "jdk-17.0.19.10-hotspot",
      )
    : null;

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

function resolveJavaHome() {
  if (process.env.JAVA_HOME && fs.existsSync(process.env.JAVA_HOME)) {
    return process.env.JAVA_HOME;
  }
  if (DEFAULT_JAVA_HOME && fs.existsSync(DEFAULT_JAVA_HOME)) {
    return DEFAULT_JAVA_HOME;
  }
  return null;
}

function resolveAndroidSdk() {
  const candidates = [
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
    process.platform === "win32"
      ? path.join(os.homedir(), "AppData", "Local", "Android", "Sdk")
      : path.join(os.homedir(), "Android", "Sdk"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function ensureLocalProperties(sdkDir) {
  const sdkPath = sdkDir.replace(/\\/g, "/");
  const content = `sdk.dir=${sdkPath}\n`;
  if (fs.existsSync(localPropertiesPath)) {
    const current = fs.readFileSync(localPropertiesPath, "utf8");
    if (current.includes("sdk.dir=")) return;
  }
  fs.writeFileSync(localPropertiesPath, content, "utf8");
  console.log(`Android SDK enregistre dans ${localPropertiesPath}`);
}

function ensurePrerequisites() {
  const javaHome = resolveJavaHome();
  if (!javaHome) {
    console.error("JAVA_HOME introuvable. Installez le JDK 17 (Temurin).");
    process.exit(1);
  }

  process.env.JAVA_HOME = javaHome;
  const javaBin = path.join(javaHome, "bin");
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? "";
  if (!currentPath.toLowerCase().includes(javaBin.toLowerCase())) {
    process.env[pathKey] = `${javaBin}${path.delimiter}${currentPath}`;
  }

  const sdkDir = resolveAndroidSdk();
  if (!sdkDir) {
    console.error("Android SDK introuvable. Installez Android Studio (SDK Manager).");
    process.exit(1);
  }

  process.env.ANDROID_HOME = sdkDir;
  process.env.ANDROID_SDK_ROOT = sdkDir;
  ensureLocalProperties(sdkDir);
}

function loadBuildEnv() {
  loadEnvFile(path.join(workspaceRoot, ".env"));
  loadEnvFile(path.join(mobileRoot, ".env.local"));
  ensurePrerequisites();

  const apiUrl = process.env.EXPO_PUBLIC_API_URL;
  if (!apiUrl || /localhost|127\.0\.0\.1/i.test(apiUrl)) {
    console.error(
      "EXPO_PUBLIC_API_URL doit pointer vers l'IP LAN du backend (ex. http://192.168.x.x:5000).",
    );
    console.error("Lancez npm run sync:env ou definissez LAN_IP / EXPO_PUBLIC_API_URL dans Mobile/.env.local.");
    process.exit(1);
  }

  return apiUrl;
}

function runGradle(task) {
  const gradlew = path.join(androidDir, process.platform === "win32" ? "gradlew.bat" : "gradlew");
  if (!fs.existsSync(gradlew)) {
    console.error(`Gradle wrapper introuvable: ${gradlew}`);
    console.error("Lancez d'abord: npx expo prebuild --platform android");
    process.exit(1);
  }

  const result = require("child_process").spawnSync(gradlew, [task], {
    cwd: androidDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
      EXPO_PUBLIC_DEMO_MODE: process.env.EXPO_PUBLIC_DEMO_MODE ?? "false",
    },
  });

  if (result.error) {
    console.error("Echec lancement Gradle:", result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error(`Build Gradle echoue (code ${result.status ?? 1}).`);
    process.exit(result.status ?? 1);
  }
}

module.exports = {
  mobileRoot,
  androidDir,
  loadBuildEnv,
  runGradle,
};
