/** @type {import("@expo/config").ExpoConfig} */
const fs = require("fs");
const path = require("path");
const {
  ANDROID_PACKAGE,
  ANDROID_VERSION_CODE,
  APP_SCHEME,
  APP_SLUG,
  APP_VERSION,
  DISPLAY_NAMES,
  IOS_BUNDLE_IDENTIFIER,
  assertReleaseApiUrl,
  profileAllowsCleartext,
  profileShowsEnvironmentBadge,
  resolveApiUrlForProfile,
  resolveReleaseProfile,
} = require("./config/releaseEnvironments");

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
  const releaseProfile = resolveReleaseProfile(process.env);
  // EXPO_PUBLIC_API_URL (+ _DEV / _PREVIEW / _PREPRODUCTION / _PRODUCTION) via releaseEnvironments.
  const apiUrl = assertReleaseApiUrl(releaseProfile, resolveApiUrlForProfile(releaseProfile, process.env));
  const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE === "true";
  const allowCleartext = profileAllowsCleartext(releaseProfile);
  const displayName = DISPLAY_NAMES[releaseProfile] || "Somafrik";

  const isProdProfile = releaseProfile === "production" || releaseProfile === "preproduction";
  if (releaseProfile !== "development" && demoMode) {
    throw new Error(`EXPO_PUBLIC_DEMO_MODE interdit en production (profil ${releaseProfile}).`);
  }
  if (releaseProfile !== "development" && process.env.EXPO_PUBLIC_DEMO_PIN) {
    throw new Error(`EXPO_PUBLIC_DEMO_PIN interdit en production (profil ${releaseProfile}).`);
  }

  return {
    ...config,
    name: displayName,
    slug: APP_SLUG,
    scheme: APP_SCHEME,
    version: APP_VERSION,
    userInterfaceStyle: "light",
      extra: {
      ...config.extra,
      apiUrl,
      releaseProfile,
      demoMode: releaseProfile === "development" ? demoMode : false,
      certificatePinningReady: true,
      showEnvironmentBadge: profileShowsEnvironmentBadge(releaseProfile),
      displayName,
      httpsOnly: isProdProfile || releaseProfile === "preview",
    },
    ios: {
      ...config.ios,
      bundleIdentifier: IOS_BUNDLE_IDENTIFIER,
      supportsTablet: true,
    },
    android: {
      ...config.android,
      package: ANDROID_PACKAGE,
      versionCode: ANDROID_VERSION_CODE,
      blockedPermissions: [
        "android.permission.RECORD_AUDIO",
        "android.permission.SYSTEM_ALERT_WINDOW",
        "android.permission.WRITE_EXTERNAL_STORAGE",
        "android.permission.READ_EXTERNAL_STORAGE",
        "android.permission.ACCESS_FINE_LOCATION",
        "android.permission.ACCESS_COARSE_LOCATION",
        "android.permission.NFC",
        "android.permission.POST_NOTIFICATIONS",
        "android.permission.READ_CONTACTS",
        "android.permission.CALL_PHONE",
        "android.permission.VIBRATE",
      ],
    },
    plugins: [
      ...(config.plugins ?? []),
      "expo-secure-store",
      [
        "expo-build-properties",
        {
          android: {
            usesCleartextTraffic: allowCleartext,
          },
        },
      ],
      "./plugins/withSomafrikAndroidSecurity",
    ],
    updates: {
      enabled: false,
    },
  };
};
