import { useState } from "react";
import {
  ActivityIndicator,
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
import {
  ROLE_SELECTION_COPY,
  ROLE_SELECTION_TEST_IDS,
  MIN_TOUCH_TARGET,
  ERROR_MESSAGES,
  mapSchoolCodeError,
} from "../lib/loginScreenSpec";
import { MOBILE_ACCESSIBILITY_COPY } from "../lib/mobileAccessibilitySpec";

type Props = NativeStackScreenProps<RootStackParamList, "RoleSelection">;
const somafrikLogo = require("../../assets/somafrik-logo.png");

export default function RoleSelectionScreen({ navigation }: Props) {
  const stackPaddingBottom = useStackScreenBottomPadding();
  const containerStyle = [styles.container, { paddingBottom: stackPaddingBottom }];
  const [accessCode, setAccessCode] = useState("CD-2026-0001");
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(`API : ${getApiBaseUrl()}`);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const verifyAccess = async () => {
    const normalizedAccess = accessCode.trim().toUpperCase();

    if (!normalizedAccess) {
      setErrorMessage(ERROR_MESSAGES.emptySchoolCode);
      return;
    }

    setErrorMessage(null);

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
      setStatusMessage(ROLE_SELECTION_COPY.successMessage);
      setErrorMessage(null);
    } catch (error) {
      setSchool(null);
      const friendly = mapSchoolCodeError(error instanceof Error ? error.message : "");
      setErrorMessage(friendly);
      setStatusMessage(friendly);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      testID={ROLE_SELECTION_TEST_IDS.screen}
      accessibilityLabel={MOBILE_ACCESSIBILITY_COPY.roleSelectionScreenLabel}
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
          <Text style={styles.eyebrow}>{ROLE_SELECTION_COPY.eyebrow}</Text>
          <Text style={styles.title}>{ROLE_SELECTION_COPY.title}</Text>
          <Text style={styles.description}>{ROLE_SELECTION_COPY.description}</Text>
        </View>

        <View style={styles.formPanel}>
          <Text style={styles.inputLabel}>{ROLE_SELECTION_COPY.codeLabel}</Text>
          <View style={styles.inputShell}>
            <Ionicons name="keypad-outline" size={20} color="#64748B" />
            <TextInput
              placeholder="CD-2026-0001"
              value={accessCode}
              onChangeText={(value) => {
                setAccessCode(value);
                setSchool(null);
                setErrorMessage(null);
                setStatusMessage(`API : ${getApiBaseUrl()}`);
              }}
              autoCapitalize="characters"
              autoCorrect={false}
              style={styles.input}
              placeholderTextColor="#94A3B8"
              testID={ROLE_SELECTION_TEST_IDS.schoolCodeInput}
              accessibilityLabel={ROLE_SELECTION_COPY.codeLabel}
            />
          </View>

          <View style={[styles.statusBox, school && styles.statusBoxSuccess, errorMessage && styles.statusBoxError]}>
            <Ionicons
              name={errorMessage ? "alert-circle-outline" : school ? "checkmark-circle-outline" : "wifi-outline"}
              size={18}
              color={errorMessage ? "#B91C1C" : school ? "#047857" : "#475569"}
            />
            <Text
              style={[
                styles.statusText,
                school && styles.statusTextSuccess,
                errorMessage && styles.statusTextError,
              ]}
            >
              {errorMessage ?? statusMessage}
            </Text>
          </View>

          {errorMessage ? (
            <View style={styles.errorBanner} testID={ROLE_SELECTION_TEST_IDS.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.primaryButton,
              (isLoading || !accessCode.trim()) && styles.disabledButton,
            ]}
            onPress={verifyAccess}
            disabled={isLoading || !accessCode.trim()}
            testID={ROLE_SELECTION_TEST_IDS.verifyButton}
            accessibilityRole="button"
            accessibilityLabel={ROLE_SELECTION_COPY.verifyButton}
          >
            {isLoading ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <Text style={styles.primaryText}>{ROLE_SELECTION_COPY.verifyButton}</Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>
        </View>

        {school && (
          <View style={styles.schoolCard} testID={ROLE_SELECTION_TEST_IDS.schoolCard}>
          <View style={styles.logo} testID={ROLE_SELECTION_TEST_IDS.schoolLogo}>
              {school.logoUrl ? (
                <Image source={{ uri: school.logoUrl }} style={styles.schoolLogoImage} />
              ) : (
                <Image source={somafrikLogo} style={styles.schoolLogoImage} />
              )}
            </View>
            <View style={styles.schoolCopy}>
              <Text style={styles.schoolName} testID={ROLE_SELECTION_TEST_IDS.schoolName}>
                {school.name}
              </Text>
              <Text style={styles.schoolCity}>{school.city} • {school.code}</Text>
              <Text style={styles.nextStepHint} testID={ROLE_SELECTION_TEST_IDS.nextStepHint}>
                {ROLE_SELECTION_COPY.nextStepHint}
              </Text>
            </View>
            <TouchableOpacity
              activeOpacity={0.88}
              style={styles.loginButton}
              onPress={() => navigation.navigate("Login", { school })}
              testID={ROLE_SELECTION_TEST_IDS.openLoginButton}
              accessibilityRole="button"
              accessibilityLabel={ROLE_SELECTION_COPY.openLoginButton}
            >
              <Text style={styles.loginText}>{ROLE_SELECTION_COPY.openLoginButton}</Text>
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
    minHeight: MIN_TOUCH_TARGET,
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
  statusBoxError: {
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
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
  statusTextError: {
    color: "#B91C1C",
  },
  errorBanner: {
    borderRadius: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 14,
  },
  errorBannerText: {
    color: "#B91C1C",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
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
  nextStepHint: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
    marginTop: 8,
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
