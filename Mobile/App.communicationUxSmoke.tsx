/**
 * Entrée recette Communication — jamais le main Expo de production.
 * Chargée seulement si Metro démarre avec SOMAFRIK_COMMUNICATION_UX_SMOKE_ENTRY=1.
 */
import { type ComponentProps } from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import { MD3LightTheme, PaperProvider, type MD3Theme } from "react-native-paper";
import CommunicationUxSmokeApp from "./recette/CommunicationUxSmokeApp";

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

function paperIcon({ name, color, size }: PaperIconProps) {
  return (
    <MaterialCommunityIcons
      name={name as ComponentProps<typeof MaterialCommunityIcons>["name"]}
      color={color}
      size={size}
    />
  );
}

export default function CommunicationUxSmokeRoot() {
  return (
    <SafeAreaProvider>
      <PaperProvider theme={paperTheme} settings={{ icon: paperIcon }}>
        <CommunicationUxSmokeApp />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
