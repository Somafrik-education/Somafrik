import "./global.css";
import type { ComponentProps } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MD3LightTheme, PaperProvider, type MD3Theme } from "react-native-paper";
import AppNavigator from "./src/navigation/AppNavigator";
import { AuthProvider } from "./src/context/AuthContext";
import { AdminDataProvider } from "./src/context/AdminDataContext";

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
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme} settings={{ icon: paperIcon }}>
        <AuthProvider>
          <AdminDataProvider>
            <AppNavigator />
          </AdminDataProvider>
        </AuthProvider>
      </PaperProvider>
    </SafeAreaProvider>
  );
}
