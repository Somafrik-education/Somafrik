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

function stripBlockedPermissions(manifest) {
  const permissions = manifest.manifest["uses-permission"];
  if (!Array.isArray(permissions)) return;
  manifest.manifest["uses-permission"] = permissions.filter((entry) => {
    const name = entry?.$?.["android:name"];
    return !BLOCKED_PERMISSIONS.has(name);
  });
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
    stripBlockedPermissions(cfg.modResults);
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
