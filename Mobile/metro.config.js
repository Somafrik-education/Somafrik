const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const projectRoot = __dirname;
const mobileNodeModules = path.resolve(projectRoot, "node_modules");
const helpCatalog = path.resolve(projectRoot, "../packages/help-catalog");

const config = withNativeWind(getDefaultConfig(projectRoot), { input: "./global.css" });

config.watchFolders = [...(config.watchFolders || []), helpCatalog];
config.resolver.nodeModulesPaths = [mobileNodeModules, ...(config.resolver.nodeModulesPaths || [])];
config.resolver.extraNodeModules = {
  ...(config.resolver.extraNodeModules || {}),
  "@babel/runtime": path.resolve(mobileNodeModules, "@babel/runtime"),
};

// Recette Communication : entrée distincte, jamais un flag EXPO_PUBLIC_* dans le runtime livré.
if (process.env.SOMAFRIK_COMMUNICATION_UX_SMOKE_ENTRY === "1") {
  const productionAppDir = path.resolve(__dirname);
  const smokeApp = path.resolve(__dirname, "App.communicationUxSmoke.tsx");
  const previousResolve = config.resolver.resolveRequest;
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    const resolved = previousResolve
      ? previousResolve(context, moduleName, platform)
      : context.resolveRequest(context, moduleName, platform);
    if (
      resolved?.type === "sourceFile" &&
      path.dirname(resolved.filePath) === productionAppDir &&
      /^App\.(tsx|ts|js|jsx)$/.test(path.basename(resolved.filePath))
    ) {
      return { type: "sourceFile", filePath: smokeApp };
    }
    return resolved;
  };
}

module.exports = config;
