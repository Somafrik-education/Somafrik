// Android enrollment only. No iOS entitlement or reader session is enabled.
const { AndroidConfig } = require("@expo/config-plugins");
module.exports = (config) => AndroidConfig.Permissions.withPermissions(config, ["android.permission.NFC"]);
