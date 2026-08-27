import "./global.css";
import { useMemo, type ComponentProps } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MD3LightTheme, PaperProvider, type MD3Theme } from "react-native-paper";
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { AdminDataProvider } from "./src/context/AdminDataContext";
import OutboxRuntime from "./src/components/OutboxRuntime";
import L1CacheRuntime from "./src/offline/l1/L1CacheRuntime";
import NativeSqlCipherBootProbe from "./src/offline/l1/NativeSqlCipherBootProbe";
import EnvironmentBadge from "./src/components/EnvironmentBadge";
import ConfigurationErrorScreen from "./src/components/ConfigurationErrorScreen";
import { resolveApiRootUrl } from "./src/config/env";

/** Thème React Native Paper aligné sur la marque Somafrik (cohérent avec le web). */
const paperTheme: MD3Theme = {
  ...MD3LightTheme,
  colors: {
    ...MD3LightTheme.colors,
    primary: "#1d4ed8",
    secondary: "#0f766e",
    error: "#dc2626",
    background: "#f7f9fc",
  },
};

type PaperIconProps = { name: string; color?: string; size: number };

/** Icônes Paper servies par @expo/vector-icons (évite react-native-vector-icons). */
function paperIcon({ name, color, size }: PaperIconProps) {
  return (
    <MaterialCommunityIcons
      name={name as ComponentProps<typeof MaterialCommunityIcons>["name"]}
      color={color}
      size={size}
    />
  );
}

export default function App() {
  const configError = useMemo(() => {
    try {
      resolveApiRootUrl();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Configuration API invalide.";
    }
  }, []);

  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme} settings={{ icon: paperIcon }}>
        <NativeSqlCipherBootProbe />
        {configError ? (
          <ConfigurationErrorScreen message={configError} />
        ) : (
          <AuthProvider>
            <AdminDataProvider>
              <OutboxRuntime />
              <L1CacheRuntime />
              <AppNavigator />
              <EnvironmentBadge />
            </AdminDataProvider>
          </AuthProvider>
        )}
      </PaperProvider>
    </SafeAreaProvider>
  );
}
