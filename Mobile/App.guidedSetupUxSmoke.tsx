/**
 * Entrée recette wizard guidé Mobile — jamais le main Expo de production.
 * Chargée seulement si Metro démarre avec SOMAFRIK_GUIDED_SETUP_UX_SMOKE_ENTRY=1.
 */
import { SafeAreaProvider } from "react-native-safe-area-context";
import GuidedSetupUxSmokeApp from "./recette/GuidedSetupUxSmokeApp";

export default function GuidedSetupUxSmokeRoot() {
  return (
    <SafeAreaProvider>
      <GuidedSetupUxSmokeApp />
    </SafeAreaProvider>
  );
}
