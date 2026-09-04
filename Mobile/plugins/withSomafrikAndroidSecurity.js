/**
 * LOT 7 — sécurité Android reproductible au prebuild :
 * backup désactivé, extraction backup restreinte, network security release HTTPS,
 * permissions minimales.
 */
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

const BLOCKED_PERMISSIONS = new Set([
  "android.permission.RECORD_AUDIO",
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.READ_MEDIA_IMAGES",
  "android.permission.ACCESS_FINE_LOCATION",
  "android.permission.ACCESS_COARSE_LOCATION",
  "android.permission.NFC",
  "android.permission.READ_CONTACTS",
  "android.permission.CALL_PHONE",
]);

const BACKUP_RULES = `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
  <exclude domain="file" path="." />
  <exclude domain="database" path="." />
  <exclude domain="sharedpref" path="." />
  <exclude domain="external" path="." />
</full-backup-content>
`;

const DATA_EXTRACTION_RULES = `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
  <cloud-backup>
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </cloud-backup>
  <device-transfer>
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
    <exclude domain="external" path="." />
  </device-transfer>
</data-extraction-rules>
`;

const NETWORK_SECURITY_RELEASE = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
</network-security-config>
`;

const NETWORK_SECURITY_DEV = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="true" />
</network-security-config>
`;

function writeXml(modRequest, relativePath, contents) {
  const filePath = path.join(modRequest.platformProjectRoot, relativePath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

function permissionName(entry) {
  return entry?.$?.["android:name"] || "";
}

function removeNode(name) {
  return {
    $: {
      "android:name": name,
      "tools:node": "remove",
    },
  };
}

function rewritePermissionList(list) {
  if (!Array.isArray(list)) return [];
  const rewritten = [];
  const seenBlocked = new Set();
  for (const entry of list) {
    const name = permissionName(entry);
    if (!BLOCKED_PERMISSIONS.has(name)) {
      rewritten.push(entry);
      continue;
    }
    if (seenBlocked.has(name)) continue;
    seenBlocked.add(name);
    rewritten.push(removeNode(name));
  }
  return rewritten;
}

/**
 * Keep tools:node="remove" in the *app* manifest so Gradle merger drops
 * library grants. Stripping the nodes (previous behavior) lets
 * expo-file-system's AAR re-inject READ/WRITE_EXTERNAL_STORAGE into the
 * final merged AAB.
 */
function ensureBlockedPermissionsRemoved(manifestDoc) {
  const root = manifestDoc.manifest.$ || (manifestDoc.manifest.$ = {});
  if (!root["xmlns:tools"]) {
    root["xmlns:tools"] = "http://schemas.android.com/tools";
  }

  const man = manifestDoc.manifest;
  man["uses-permission"] = rewritePermissionList(man["uses-permission"]);
  if (Array.isArray(man["uses-permission-sdk-23"])) {
    man["uses-permission-sdk-23"] = rewritePermissionList(man["uses-permission-sdk-23"]);
  }

  const existing = new Set((man["uses-permission"] || []).map(permissionName));
  man["uses-permission"] = man["uses-permission"] || [];
  for (const name of BLOCKED_PERMISSIONS) {
    if (existing.has(name)) continue;
    man["uses-permission"].push(removeNode(name));
    existing.add(name);
  }
}

function withSomafrikAndroidSecurity(config) {
  const releaseProfile = config.extra?.releaseProfile;
  const allowCleartext = releaseProfile === "development";

  config = withDangerousMod(config, [
    "android",
    async (cfg) => {
      writeXml(cfg.modRequest, "app/src/main/res/xml/backup_rules.xml", BACKUP_RULES);
      writeXml(cfg.modRequest, "app/src/main/res/xml/data_extraction_rules.xml", DATA_EXTRACTION_RULES);
      writeXml(
        cfg.modRequest,
        "app/src/main/res/xml/network_security_config.xml",
        allowCleartext ? NETWORK_SECURITY_DEV : NETWORK_SECURITY_RELEASE,
      );
      return cfg;
    },
  ]);

  config = withAndroidManifest(config, (cfg) => {
    ensureBlockedPermissionsRemoved(cfg.modResults);
    const app = AndroidConfig.Manifest.getMainApplicationOrThrow(cfg.modResults);
    app.$["android:allowBackup"] = "false";
    app.$["android:fullBackupContent"] = "@xml/backup_rules";
    app.$["android:dataExtractionRules"] = "@xml/data_extraction_rules";
    app.$["android:networkSecurityConfig"] = "@xml/network_security_config";
    app.$["android:usesCleartextTraffic"] = allowCleartext ? "true" : "false";
    return cfg;
  });

  return config;
}

module.exports = withSomafrikAndroidSecurity;
