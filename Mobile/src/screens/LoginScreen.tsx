import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { RootStackParamList } from "../navigation/AppNavigator";
import { IdentifyResponse, changePassword, identifyAccount, login, LoginResponse } from "../services/api";
import { useAuth } from "../context/AuthContext";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  LOGIN_SCREEN_COPY,
  LOGIN_TEST_IDS,
  MIN_TOUCH_TARGET,
  ERROR_MESSAGES,
  canSubmitLogin,
  mapLoginApiError,
  resolveIdentifierKeyboardType,
  resolveSecretKeyboardType,
} from "../lib/loginScreenSpec";
import { MOBILE_ACCESSIBILITY_COPY } from "../lib/mobileAccessibilitySpec";

type Props = NativeStackScreenProps<RootStackParamList, "Login">;
const somafrikLogo = require("../../assets/somafrik-logo.png");

export default function LoginScreen({ navigation, route }: Props) {
  const { school, accessIdentifier, accessRole, accessRoleLabel } = route.params;
  const [identifier, setIdentifier] = useState(accessIdentifier ?? "");
  const [password, setPassword] = useState("");
  const [identity, setIdentity] = useState<IdentifyResponse | null>(
    accessRole ? { role: accessRole, roleLabel: accessRoleLabel ?? "Administrateur" } : null
  );
  const [isIdentifying, setIsIdentifying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSession, setPendingSession] = useState<LoginResponse | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const { setSession } = useAuth();

  useEffect(() => {
    const normalizedIdentifier = identifier.trim();
    if (accessRole) {
      setIdentity({ role: accessRole, roleLabel: accessRoleLabel ?? "Administrateur" });
      return;
    }

    setIdentity(null);
    setErrorMessage(null);

    if (normalizedIdentifier.length < 3) {
      return;
    }

    const timeout = setTimeout(async () => {
      setIsIdentifying(true);

      try {
        const result = await identifyAccount({
          schoolCode: school.code,
          identifier: normalizedIdentifier,
        });
        setIdentity(result);
        setErrorMessage(null);
      } catch {
        setIdentity(null);
        if (normalizedIdentifier.length >= 3) {
          setErrorMessage(ERROR_MESSAGES.invalidIdentifier);
        }
      } finally {
        setIsIdentifying(false);
      }
    }, 450);

    return () => clearTimeout(timeout);
  }, [accessRole, accessRoleLabel, identifier, school.code]);

  const handleLogin = async () => {
    if (!identifier.trim() || !password.trim()) {
      setErrorMessage(ERROR_MESSAGES.emptyFields);
      return;
    }

    if (!identity) {
      setErrorMessage(ERROR_MESSAGES.invalidIdentifier);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);

    try {
      const session = await login({
        role: identity.role,
        schoolCode: school.code,
        identifier: identifier.trim(),
        pin: password.trim(),
      });

      if (session.user.mustChangePassword) {
        setPendingSession(session);
        setNewPassword("");
        setConfirmPassword("");
        return;
      }

      completeLogin(session);
    } catch (error) {
      setErrorMessage(
        mapLoginApiError(error instanceof Error ? error.message : "", identity?.role),
      );
    } finally {
      setIsLoading(false);
    }
  };

  const fillDemo = (demo: "country_admin" | "school_admin" | "prefet" | "secretary" | "teacher" = "teacher") => {
    if (!accessRole) {
      setIdentifier(
        demo === "country_admin"
          ? "admin-rdc"
          : demo === "school_admin"
            ? "admin"
            : demo === "prefet"
              ? "prefet"
              : demo === "secretary"
                ? "secretaire"
                : "ENS-0001"
      );
    }
    setPassword("1234");
  };

  const completeLogin = (session: LoginResponse) => {
    setSession(session);
    navigation.navigate("Home", {
      role: session.role,
    });
  };

  const submitNewPassword = async () => {
    if (!pendingSession) return;
    if (newPassword.trim().length < 6) {
      Alert.alert("Mot de passe trop court", "Le nouveau mot de passe doit contenir au moins 6 caractères.");
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      Alert.alert("Confirmation incorrecte", "Les deux mots de passe ne correspondent pas.");
      return;
    }

    setIsChangingPassword(true);
    try {
      const response = await changePassword(newPassword.trim());
      completeLogin({
        ...pendingSession,
        accessToken: response.accessToken ?? pendingSession.accessToken,
        user: {
          ...pendingSession.user,
          ...response.user,
          mustChangePassword: false,
        },
      });
      setPendingSession(null);
    } catch (error) {
      Alert.alert("Modification impossible", error instanceof Error ? error.message : "Veuillez réessayer.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  const loginReady = canSubmitLogin(identity, identifier, password, isLoading);
  const identifierKeyboard = resolveIdentifierKeyboardType(identifier);
  const secretKeyboard = resolveSecretKeyboardType(identity?.role);

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "bottom"]}
      testID={LOGIN_TEST_IDS.screen}
      accessible
      accessibilityLabel={MOBILE_ACCESSIBILITY_COPY.loginScreenLabel}
    >
      <View style={styles.schoolLogo} testID={LOGIN_TEST_IDS.schoolLogo}>
        {school.logoUrl ? (
          <Image source={{ uri: school.logoUrl }} style={styles.schoolLogoImage} />
        ) : (
          <Image source={somafrikLogo} style={styles.schoolLogoImage} />
        )}
      </View>
      <Text style={styles.title} testID={LOGIN_TEST_IDS.schoolName}>{school.name}</Text>
      <Text style={styles.subtitle}>{school.city} • {school.code}</Text>

      <Text style={styles.instructionText} testID={LOGIN_TEST_IDS.instructionText}>
        {LOGIN_SCREEN_COPY.identifierHint}
      </Text>

      <TextInput
        placeholder={LOGIN_SCREEN_COPY.identifierPlaceholder}
        value={identifier}
        onChangeText={(value) => {
          setIdentifier(value);
          setErrorMessage(null);
        }}
        autoCapitalize="none"
        keyboardType={identifierKeyboard}
        textContentType={identifierKeyboard === "email-address" ? "emailAddress" : "username"}
        autoComplete={identifierKeyboard === "email-address" ? "email" : "username"}
        style={styles.input}
        editable={!accessRole}
        testID={LOGIN_TEST_IDS.identifierInput}
        accessibilityLabel={LOGIN_SCREEN_COPY.identifierPlaceholder}
      />

      <View style={styles.roleRow}>
        <Text style={styles.roleLabel}>{LOGIN_SCREEN_COPY.roleLabel}</Text>
        <View style={styles.roleBadgeWrap}>
          {isIdentifying ? (
            <ActivityIndicator size="small" color="#2563EB" style={styles.roleBadgeSpinner} />
          ) : null}
          <Text
            style={[
              styles.roleBadge,
              !identity && styles.roleBadgeMuted,
              isIdentifying && styles.roleBadgeHidden,
            ]}
            testID={LOGIN_TEST_IDS.roleBadge}
          >
            {identity?.roleLabel ?? LOGIN_SCREEN_COPY.rolePending}
          </Text>
        </View>
      </View>

      {identity && (
        <TextInput
          placeholder={
            identity.role === "parent_student" || identity.role === "student"
              ? LOGIN_SCREEN_COPY.pinPlaceholder
              : LOGIN_SCREEN_COPY.passwordPlaceholder
          }
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            setErrorMessage(null);
          }}
          secureTextEntry
          keyboardType={secretKeyboard}
          textContentType="password"
          autoComplete="password"
          style={styles.input}
          testID={LOGIN_TEST_IDS.passwordInput}
          accessibilityLabel={
            identity.role === "parent_student" || identity.role === "student"
              ? LOGIN_SCREEN_COPY.pinPlaceholder
              : LOGIN_SCREEN_COPY.passwordPlaceholder
          }
        />
      )}

      {errorMessage ? (
        <View style={styles.errorBanner} testID={LOGIN_TEST_IDS.errorBanner} accessibilityRole="alert">
          <Ionicons name="alert-circle-outline" size={18} color="#B91C1C" />
          <Text style={styles.errorText}>{errorMessage}</Text>
        </View>
      ) : null}

      <TouchableOpacity
        style={[styles.loginButton, !loginReady && styles.loginButtonDisabled]}
        onPress={handleLogin}
        disabled={!loginReady}
        testID={LOGIN_TEST_IDS.loginButton}
        accessibilityRole="button"
        accessibilityLabel={LOGIN_SCREEN_COPY.loginButton}
        accessibilityState={{ disabled: !loginReady, busy: isLoading }}
      >
        {isLoading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Text style={styles.loginButtonText}>{LOGIN_SCREEN_COPY.loginButton}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity style={styles.demoButton} onPress={() => fillDemo("teacher")}>
        <Text style={styles.demoButtonText}>Remplir un compte enseignant demo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.demoButton} onPress={() => fillDemo("school_admin")}>
        <Text style={styles.demoButtonText}>Remplir admin établissement demo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.demoButton} onPress={() => fillDemo("prefet")}>
        <Text style={styles.demoButtonText}>Remplir préfet des études demo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.demoButton} onPress={() => fillDemo("secretary")}>
        <Text style={styles.demoButtonText}>Remplir secrétaire demo</Text>
      </TouchableOpacity>
      <TouchableOpacity style={styles.demoButton} onPress={() => fillDemo("country_admin")}>
        <Text style={styles.demoButtonText}>Remplir admin pays demo</Text>
      </TouchableOpacity>

      <Modal visible={Boolean(pendingSession)} transparent animationType="fade">
        <View style={styles.modalBackdrop}>
          <View style={styles.passwordCard} testID="login-password-change-modal">
            <Text style={styles.passwordTitle}>Nouveau mot de passe</Text>
            <Text style={styles.passwordHint}>
              Votre mot de passe temporaire a été accepté. Choisissez maintenant votre mot de passe personnel.
            </Text>
            <TextInput
              placeholder="Nouveau mot de passe"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              style={styles.input}
            />
            <TextInput
              placeholder="Confirmer le mot de passe"
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              style={styles.input}
            />
            <TouchableOpacity
              style={[styles.loginButton, isChangingPassword && styles.loginButtonDisabled]}
              onPress={submitNewPassword}
              disabled={isChangingPassword}
            >
              {isChangingPassword ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.loginButtonText}>Valider</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
    backgroundColor: "#FFFFFF",
  },
  schoolLogo: {
    width: 96,
    height: 96,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  schoolLogoImage: {
    width: 88,
    height: 88,
    borderRadius: 22,
    resizeMode: "contain",
  },
  title: {
    fontSize: 26,
    fontWeight: "900",
    color: "#0F172A",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#64748B",
    fontWeight: "800",
    marginTop: 6,
    marginBottom: 16,
    textAlign: "center",
  },
  instructionText: {
    width: "100%",
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 20,
    marginBottom: 14,
    textAlign: "center",
  },
  input: {
    width: "100%",
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    borderRadius: 14,
    padding: 13,
    marginBottom: 14,
    color: "#0F172A",
    fontWeight: "800",
  },
  roleRow: {
    width: "100%",
    backgroundColor: "#F8FAFC",
    borderRadius: 14,
    padding: 12,
    marginBottom: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  roleLabel: {
    color: "#64748B",
    fontWeight: "900",
  },
  roleBadge: {
    color: "#2563EB",
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    fontWeight: "900",
  },
  roleBadgeMuted: {
    color: "#94A3B8",
    backgroundColor: "#F1F5F9",
  },
  roleBadgeWrap: {
    position: "relative",
    minWidth: 88,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  roleBadgeSpinner: {
    position: "absolute",
  },
  roleBadgeHidden: {
    opacity: 0,
  },
  errorBanner: {
    width: "100%",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "#FEF2F2",
    borderWidth: 1,
    borderColor: "#FECACA",
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    marginBottom: 14,
  },
  errorText: {
    flex: 1,
    color: "#B91C1C",
    fontSize: 14,
    fontWeight: "800",
    lineHeight: 20,
  },
  loginButton: {
    width: "100%",
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: "#2563EB",
    padding: 15,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  loginButtonDisabled: {
    opacity: 0.55,
  },
  loginButtonText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "900",
  },
  demoButton: {
    marginTop: 16,
    padding: 12,
  },
  demoButtonText: {
    color: "#2563EB",
    fontSize: 14,
    fontWeight: "900",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(15, 23, 42, 0.45)",
    justifyContent: "center",
    padding: 24,
  },
  passwordCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 22,
    padding: 18,
  },
  passwordTitle: {
    color: "#0F172A",
    fontSize: 22,
    fontWeight: "900",
    marginBottom: 8,
  },
  passwordHint: {
    color: "#64748B",
    fontSize: 14,
    fontWeight: "700",
    marginBottom: 16,
  },
});
