const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const catalogRoot = path.resolve(projectRoot, "../packages/help-catalog");
const mobileNodeModules = path.resolve(projectRoot, "node_modules");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [...(config.watchFolders || []), catalogRoot];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@somafrik/help-catalog": catalogRoot,
  "@babel/runtime": path.resolve(mobileNodeModules, "@babel/runtime"),
};
config.resolver.unstable_enablePackageExports = true;

const withCss = withNativeWind(config, { input: "./global.css" });
const innerResolve = withCss.resolver.resolveRequest;

withCss.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "@babel/runtime" || moduleName.startsWith("@babel/runtime/")) {
    return {
      filePath: require.resolve(moduleName, { paths: [mobileNodeModules] }),
      type: "sourceFile",
    };
  }
  if (typeof innerResolve === "function") {
    return innerResolve(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = withCss;
