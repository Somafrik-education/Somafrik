const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = withNativeWind(getDefaultConfig(__dirname), { input: "./global.css" });

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
