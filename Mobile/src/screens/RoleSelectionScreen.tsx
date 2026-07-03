import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { SchoolInfo, getApiBaseUrl, getSchoolByCode } from "../services/api";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

type Props = NativeStackScreenProps<RootStackParamList, "RoleSelection">;
const somafrikLogo = require("../../assets/somafrik-logo.png");

export default function RoleSelectionScreen({ navigation }: Props) {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const containerStyle = [styles.container, { paddingBottom: stackPaddingBottom }];
  const [accessCode, setAccessCode] = useState("CD-2026-0001");
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(`API : ${getApiBaseUrl()}`);

  const verifyAccess = async () => {
    const normalizedAccess = accessCode.trim().toUpperCase();

    if (!normalizedAccess) {
      Alert.alert("Accès Somafrik", "Veuillez saisir un code établissement ou un identifiant admin.");
      return;
    }

    if (
      normalizedAccess === "SUPERADMIN" ||
      normalizedAccess === "SUPERADMIN-SOMAFRIK"
    ) {
      navigation.navigate("Login", {
        school: getPlatformSchool("Global"),
        accessIdentifier: "superadmin",
        accessRole: "super_admin",
        accessRoleLabel: "Super Administrateur",
      });
      return;
    }

    if (normalizedAccess.startsWith("ADMINPAYS-")) {
      const countryCode = normalizedAccess.replace("ADMINPAYS-", "");
      navigation.navigate("Login", {
        school: getPlatformSchool(countryCode),
        accessIdentifier: countryCode === "CD" ? "admin-rdc" : `admin-${countryCode.toLowerCase()}`,
        accessRole: "country_admin",
        accessRoleLabel: "Admin Pays",
      });
      return;
    }

    setIsLoading(true);

    try {
      const result = await getSchoolByCode(accessCode);
      setSchool(result);
      setStatusMessage("Établissement trouvé. Vous pouvez continuer.");
    } catch (error) {
      setSchool(null);
      setStatusMessage("Impossible de joindre l'API. Vérifiez le Wi-Fi du téléphone et le backend sur le PC.");
      Alert.alert(
        "Établissement introuvable",
        error instanceof Error ? error.message : "Code établissement invalide"
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={containerStyle}
      >
        <View style={styles.header}>
          <View style={styles.mark}>
            <Image source={somafrikLogo} style={styles.markLogo} />
          </View>
          <View style={styles.headerText}>
            <Text style={styles.brand}>Somafrik</Text>
            <Text style={styles.subtitle}>ERP scolaire par Somafrik</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Connexion établissement</Text>
          <Text style={styles.title}>Entrez le code de votre école</Text>
          <Text style={styles.description}>
            Utilisez le code fourni par l'administration pour ouvrir les espaces élève, parent, enseignant et direction.
          </Text>
        </View>

        <View style={styles.formPanel}>
          <Text style={styles.inputLabel}>Code établissement</Text>
          <View style={styles.inputShell}>
            <Ionicons name="keypad-outline" size={20} color="#64748B" />
            <TextInput
              placeholder="CD-2026-0001"
              value={accessCode}
              onChangeText={(value) => {
                setAccessCode(value);
                setSchool(null);
                setStatusMessage(`API : ${getApiBaseUrl()}`);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
            />
          </View>

          <View style={[styles.statusBox, school && styles.statusBoxSuccess]}>
            <Ionicons
              name={school ? "checkmark-circle-outline" : "wifi-outline"}
              size={18}
              color={school ? "#047857" : "#475569"}
            />
            <Text style={[styles.statusText, school && styles.statusTextSuccess]}>
              {statusMessage}
            </Text>
          </View>

          <TouchableOpacity
            activeOpacity={0.88}
            style={[styles.primaryButton, isLoading && styles.disabledButton]}
            onPress={verifyAccess}
            disabled={isLoading}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryText}>Vérifier le code</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>
        </View>

        {school && (
          <View style={styles.schoolCard}>
          <View style={styles.logo}>
              <Image source={somafrikLogo} style={styles.schoolLogoImage} />
            </View>
            <View style={styles.schoolCopy}>
              <Text style={styles.schoolName}>{school.name}</Text>
              <Text style={styles.schoolCity}>{school.city} • {school.code}</Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.88}
              style={styles.loginButton}
              onPress={() => navigation.navigate("Login", { school })}
            >
              <Text style={styles.loginText}>Ouvrir la connexion</Text>
              <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.helpBox}>
          <Ionicons name="information-circle-outline" size={18} color="#2563EB" />
          <Text style={styles.helpText}>
            Connexion obligatoire à l'API Somafrik. Vérifiez le backend si le réseau échoue.
          </Text>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function getPlatformSchool(scope: string): SchoolInfo {
  return {
    id: `PLATFORM-${scope}`,
    publicId: scope,
    code: "CD-2026-0001",
    name: scope === "Global" ? "Somafrik Global" : `Somafrik ${scope}`,
    city: scope === "Global" ? "Plateforme" : scope,
    country: scope,
    slogan: "ERP scolaire mobile et tablette par Somafrik",
    status: "Actif",
  };
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F8FB",
  },
  container: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 54,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 32,
  },
  mark: {
    width: 72,
    height: 72,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  markLogo: { width: 64, height: 64, resizeMode: "contain" },
  headerText: {
    flex: 1,
  },
  brand: {
    color: "#0F172A",
    fontSize: 32,
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 3,
    color: "#64748B",
    fontSize: 14,
    fontWeight: "800",
  },
  hero: {
    marginBottom: 22,
  },
  eyebrow: {
    color: "#0F766E",
    fontSize: 13,
    fontWeight: "900",
    textTransform: "uppercase",
    marginBottom: 8,
  },
  title: {
    color: "#0F172A",
    fontSize: 30,
    fontWeight: "900",
    lineHeight: 36,
  },
  description: {
    color: "#64748B",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 22,
    marginTop: 10,
  },
  formPanel: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 16,
  },
  inputLabel: {
    color: "#334155",
    fontSize: 13,
    fontWeight: "900",
    marginBottom: 8,
  },
  inputShell: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderWidth: 1,
    borderColor: "#CBD5E1",
    borderRadius: 8,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  input: {
    flex: 1,
    paddingVertical: 15,
    paddingHorizontal: 10,
    color: "#0F172A",
    fontSize: 20,
    fontWeight: "800",
  },
  statusBox: {
    minHeight: 48,
    borderRadius: 8,
    backgroundColor: "#F1F5F9",
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  statusBoxSuccess: {
    backgroundColor: "#ECFDF5",
  },
  statusText: {
    flex: 1,
    color: "#475569",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginLeft: 8,
  },
  statusTextSuccess: {
    color: "#047857",
  },
  primaryButton: {
    minHeight: 54,
    backgroundColor: "#0F172A",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  disabledButton: {
    opacity: 0.75,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 16,
  },
  schoolCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    padding: 14,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 14,
  },
  logo: {
    width: 72,
    height: 72,
    borderRadius: 12,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    borderWidth: 1,
    borderColor: "#D1FAE5",
  },
  schoolLogoImage: { width: 64, height: 64, resizeMode: "contain" },
  schoolCopy: {
    flex: 1,
    minWidth: 0,
  },
  schoolName: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  schoolCity: {
    color: "#64748B",
    fontWeight: "800",
    marginTop: 4,
  },
  loginButton: {
    backgroundColor: "#0F766E",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  loginText: {
    color: "#FFFFFF",
    fontWeight: "900",
    fontSize: 12,
  },
  helpBox: {
    flexDirection: "row",
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  helpText: {
    flex: 1,
    color: "#1E40AF",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 18,
    marginLeft: 8,
  },
});
