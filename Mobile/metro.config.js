const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const catalogRoot = path.resolve(projectRoot, "../packages/help-catalog");
const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders || []), catalogRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@somafrik/help-catalog": catalogRoot,
};
config.resolver.unstable_enablePackageExports = true;

module.exports = withNativeWind(config, { input: "./global.css" });
