import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import FormField from "../components/FormField";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { SchoolInfo, getApiBaseUrl, getSchoolByCode } from "../services/api";
import { buildPlatformLoginParams } from "../lib/platformLogin";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  ROLE_SELECTION_COPY,
  ROLE_SELECTION_TEST_IDS,
  ERROR_MESSAGES,
  mapSchoolCodeError,
} from "../lib/loginScreenSpec";
import { MOBILE_ACCESSIBILITY_COPY } from "../lib/mobileAccessibilitySpec";
import {
  formatRoleSelectionApiStatus,
  getRoleSelectionLayout,
} from "../lib/roleSelectionLayout";

type Props = NativeStackScreenProps<RootStackParamList, "RoleSelection">;
const somafrikLogo = require("../../assets/somafrik-logo.png");

export default function RoleSelectionScreen({ navigation }: Props) {
  const { width, height, fontScale } = useWindowDimensions();
  const layout = getRoleSelectionLayout(width, height, fontScale);
  const stackPaddingBottom = useStackScreenBottomPadding();
  const scrollRef = useRef<ScrollView>(null);
  const [accessCode, setAccessCode] = useState("");
  const [school, setSchool] = useState<SchoolInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(formatRoleSelectionApiStatus(getApiBaseUrl()));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!school) return;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [school]);

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
      navigation.navigate("Login", buildPlatformLoginParams("global"));
      return;
    }

    if (normalizedAccess.startsWith("ADMINPAYS-")) {
      const countryCode = normalizedAccess.replace("ADMINPAYS-", "");
      navigation.navigate("Login", buildPlatformLoginParams("country", countryCode));
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

  const idleStatus = formatRoleSelectionApiStatus(getApiBaseUrl());
  const showApiDiagnostic = !school && !errorMessage;
  const showHelp = layout.showHelp && !school;

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : "padding"}
      keyboardVerticalOffset={Platform.OS === "android" ? 8 : 56}
      testID={ROLE_SELECTION_TEST_IDS.screen}
      accessibilityLabel={MOBILE_ACCESSIBILITY_COPY.roleSelectionScreenLabel}
    >
      <ScrollView
        ref={scrollRef}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[
          styles.container,
          {
            flexGrow: 1,
            paddingHorizontal: layout.screenPaddingHorizontal,
            paddingTop: layout.screenPaddingTop,
            paddingBottom: Math.min(stackPaddingBottom, layout.screenPaddingBottom + 24),
          },
        ]}
      >
        <View style={[styles.header, { marginBottom: layout.headerMarginBottom }]}>
          <View
            style={[
              styles.mark,
              { width: layout.brandLogo, height: layout.brandLogo, borderRadius: 10, marginRight: layout.brandGap },
            ]}
          >
            <Image
              source={somafrikLogo}
              style={{ width: layout.brandLogo - 6, height: layout.brandLogo - 6, resizeMode: "contain" }}
            />
          </View>
          <View style={styles.headerText}>
            <Text style={[styles.brand, { fontSize: layout.brandTitle, lineHeight: Math.round(layout.brandTitle * 1.15) }]}>
              Somafrik
            </Text>
            <Text style={[styles.subtitle, { fontSize: layout.brandSubtitle }]}>ERP scolaire par Somafrik</Text>
          </View>
        </View>

        <View style={[styles.hero, { marginBottom: school ? 0 : layout.heroMarginBottom }]}>
          {school ? null : (
            <>
              <Text
                style={[
                  styles.eyebrow,
                  { fontSize: layout.eyebrow, marginBottom: layout.tight ? 4 : 6 },
                ]}
              >
                {ROLE_SELECTION_COPY.eyebrow}
              </Text>
              <Text
                style={[
                  styles.title,
                  { fontSize: layout.title, lineHeight: layout.titleLineHeight },
                ]}
              >
                {ROLE_SELECTION_COPY.title}
              </Text>
              <Text
                style={[
                  styles.description,
                  {
                    fontSize: layout.description,
                    lineHeight: layout.descriptionLineHeight,
                    marginTop: layout.tight ? 4 : 6,
                  },
                ]}
              >
                {ROLE_SELECTION_COPY.description}
              </Text>
            </>
          )}
        </View>

        <View style={[styles.formPanel, { padding: layout.panelPadding }]}>
          <FormField
            label={ROLE_SELECTION_COPY.codeLabel}
            required
            type="code"
            placeholder={ROLE_SELECTION_COPY.placeholderExample}
            value={accessCode}
            onChangeText={(value) => {
              setAccessCode(value);
              setSchool(null);
              setErrorMessage(null);
              setStatusMessage(idleStatus);
            }}
            autoCapitalize="characters"
            autoCorrect={false}
            leading={<Ionicons name="keypad-outline" size={18} color="#64748B" />}
            testID={ROLE_SELECTION_TEST_IDS.schoolCodeInput}
            accessibilityLabel={ROLE_SELECTION_COPY.codeLabel}
            inputStyle={[styles.codeInput, { fontSize: layout.code }]}
            variant={layout.tight ? "compact" : "default"}
          />

          {school ? null : (
            <TouchableOpacity
            activeOpacity={0.88}
            style={[
              styles.primaryButton,
              { minHeight: layout.buttonMinHeight },
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
                <Text style={[styles.primaryText, { fontSize: layout.button }]}>
                  {ROLE_SELECTION_COPY.verifyButton}
                </Text>
                <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
              </>
            )}
          </TouchableOpacity>
          )}

          {showApiDiagnostic ? (
            <Text
              style={[styles.diagnostic, { fontSize: layout.diagnosticFont }]}
              numberOfLines={1}
              ellipsizeMode="middle"
              testID={ROLE_SELECTION_TEST_IDS.statusMessage}
            >
              {idleStatus}
            </Text>
          ) : (
            <Text
              style={styles.srStatus}
              testID={ROLE_SELECTION_TEST_IDS.statusMessage}
            >
              {errorMessage ?? statusMessage}
            </Text>
          )}

          {errorMessage ? (
            <View style={styles.errorBanner} testID={ROLE_SELECTION_TEST_IDS.errorBanner} accessibilityRole="alert">
              <Text style={styles.errorBannerText}>{errorMessage}</Text>
            </View>
          ) : null}

          {school && (
            <View style={styles.schoolCard} testID={ROLE_SELECTION_TEST_IDS.schoolCard}>
              <View style={styles.schoolHeader}>
                <View
                  style={[
                    styles.logo,
                    { width: layout.schoolLogo, height: layout.schoolLogo, marginRight: 10 },
                  ]}
                  testID={ROLE_SELECTION_TEST_IDS.schoolLogo}
                >
                  {school.logoUrl ? (
                    <Image source={{ uri: school.logoUrl }} style={styles.schoolLogoImage} />
                  ) : (
                    <Image source={somafrikLogo} style={styles.schoolLogoImage} />
                  )}
                </View>
                <View style={styles.schoolCopy}>
                  <Text style={styles.foundLabel}>{ROLE_SELECTION_COPY.successMessage}</Text>
                  <Text style={styles.schoolName} testID={ROLE_SELECTION_TEST_IDS.schoolName}>
                    {school.name}
                  </Text>
                  <Text style={styles.schoolCity}>
                    {school.city} • {school.code}
                  </Text>
                </View>
              </View>
              <Text style={styles.nextStepHint} testID={ROLE_SELECTION_TEST_IDS.nextStepHint}>
                {ROLE_SELECTION_COPY.nextStepHint}
              </Text>
              <TouchableOpacity
                activeOpacity={0.88}
                style={[styles.loginButton, { minHeight: layout.buttonMinHeight }]}
                onPress={() => navigation.navigate("Login", { school })}
                testID={ROLE_SELECTION_TEST_IDS.openLoginButton}
                accessibilityRole="button"
                accessibilityLabel={ROLE_SELECTION_COPY.openLoginButton}
              >
                <Text style={[styles.loginText, { fontSize: layout.button }]}>
                  {ROLE_SELECTION_COPY.openLoginButton}
                </Text>
                <Ionicons name="log-in-outline" size={18} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          )}
        </View>

        {showHelp ? (
          <View style={styles.helpBox}>
            <Ionicons name="information-circle-outline" size={16} color="#2563EB" />
            <Text style={styles.helpText}>
              Connexion obligatoire à l'API Somafrik. Vérifiez le backend si le réseau échoue.
            </Text>
          </View>
        ) : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F8FB",
  },
  container: {
    flexGrow: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
  },
  mark: {
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  brand: {
    color: "#0F172A",
    fontWeight: "900",
  },
  subtitle: {
    marginTop: 1,
    color: "#64748B",
    fontWeight: "700",
  },
  hero: {},
  eyebrow: {
    color: "#0F766E",
    fontWeight: "900",
    textTransform: "uppercase",
  },
  title: {
    color: "#0F172A",
    fontWeight: "900",
  },
  description: {
    color: "#64748B",
    fontWeight: "600",
  },
  formPanel: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    marginBottom: 12,
  },
  codeInput: {
    fontWeight: "800",
  },
  diagnostic: {
    color: "#64748B",
    fontWeight: "700",
    marginTop: 8,
  },
  srStatus: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
  errorBanner: {
    borderRadius: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 10,
  },
  errorBannerText: {
    color: "#B91C1C",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: "#0F172A",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  disabledButton: {
    opacity: 0.75,
  },
  primaryText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  schoolCard: {
    flexDirection: "column",
    backgroundColor: "#F0FDF4",
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: "#BBF7D0",
    marginTop: 12,
    width: "100%",
  },
  schoolHeader: {
    flexDirection: "row",
    alignItems: "center",
  },
  logo: {
    borderRadius: 10,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "#D1FAE5",
  },
  schoolLogoImage: { width: 28, height: 28, resizeMode: "contain" },
  schoolCopy: {
    flex: 1,
    minWidth: 0,
  },
  foundLabel: {
    color: "#047857",
    fontSize: 12,
    fontWeight: "800",
    marginBottom: 2,
  },
  schoolName: {
    color: "#0F172A",
    fontSize: 16,
    fontWeight: "900",
  },
  schoolCity: {
    color: "#64748B",
    fontWeight: "700",
    fontSize: 13,
    marginTop: 2,
  },
  nextStepHint: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 16,
    marginTop: 8,
    marginBottom: 10,
  },
  loginButton: {
    backgroundColor: "#0F766E",
    borderRadius: 8,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    width: "100%",
  },
  loginText: {
    color: "#FFFFFF",
    fontWeight: "900",
  },
  helpBox: {
    flexDirection: "row",
    backgroundColor: "#EFF6FF",
    borderRadius: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#BFDBFE",
  },
  helpText: {
    flex: 1,
    color: "#1E40AF",
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 16,
    marginLeft: 8,
  },
});
