import { Animated, Image, Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { RootStackParamList } from "../navigation/AppNavigator";
import { WELCOME_SCREEN_COPY, WELCOME_TEST_IDS } from "../lib/welcomeScreenSpec";
import { MIN_TOUCH_TARGET } from "../lib/mobileAccessibilitySpec";
import { LEGAL_COPY, PRIVACY_POLICY_URL, ACCOUNT_DELETION_URL } from "../lib/legalCompliance";

type Props = NativeStackScreenProps<RootStackParamList, "Welcome">;
const somafrikLogo = require("../../assets/somafrik-logo.png");

export default function WelcomeScreen({ navigation }: Props) {
  const opacity = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(0.94)).current;
  const buttonOffset = useRef(new Animated.Value(18)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true }),
        Animated.timing(scale, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
      Animated.timing(buttonOffset, { toValue: 0, duration: 360, useNativeDriver: true }),
    ]).start();
  }, [buttonOffset, opacity, scale]);

  return (
    <SafeAreaView
      style={styles.container}
      edges={["top", "bottom"]}
      testID={WELCOME_TEST_IDS.screen}
      accessibilityLabel="Écran d'accueil Somafrik"
    >
      <Animated.View
        style={[styles.logoBox, { opacity, transform: [{ scale }] }]}
        testID={WELCOME_TEST_IDS.logo}
        accessibilityLabel="Logo Somafrik"
      >
        <Image
          source={somafrikLogo}
          style={styles.logoImage}
          accessibilityIgnoresInvertColors
        />
      </Animated.View>
      <Animated.Text
        style={[styles.brand, { opacity }]}
        testID={WELCOME_TEST_IDS.brand}
        accessibilityRole="header"
      >
        {WELCOME_SCREEN_COPY.brandName}
      </Animated.Text>
      <Animated.Text style={[styles.parentBrand, { opacity }]} testID={WELCOME_TEST_IDS.parentBrand}>
        {WELCOME_SCREEN_COPY.parentBrand}
      </Animated.Text>
      <Animated.Text style={[styles.subtitle, { opacity }]} testID={WELCOME_TEST_IDS.subtitle}>
        {WELCOME_SCREEN_COPY.subtitle}
      </Animated.Text>
      <Animated.View style={{ transform: [{ translateY: buttonOffset }], opacity }}>
        <TouchableOpacity
          activeOpacity={0.86}
          style={styles.button}
          testID={WELCOME_TEST_IDS.loginButton}
          accessibilityRole="button"
          accessibilityLabel={WELCOME_SCREEN_COPY.loginButtonLabel}
          onPress={() => navigation.navigate("RoleSelection")}
        >
          <Text style={styles.buttonText}>{WELCOME_SCREEN_COPY.loginButtonLabel}</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={LEGAL_COPY.privacy}
        onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)}
        style={styles.legalLink}
        testID="welcome-privacy-policy"
      >
        <Text style={styles.legalLinkText}>{LEGAL_COPY.privacy}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="link"
        accessibilityLabel={LEGAL_COPY.deletion}
        onPress={() => void Linking.openURL(ACCOUNT_DELETION_URL)}
        style={styles.legalLink}
        testID="welcome-account-deletion"
      >
        <Text style={styles.legalLinkText}>{LEGAL_COPY.deletion}</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#F8FAFC",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  logoBox: {
    width: 148,
    height: 148,
    borderRadius: 34,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 20,
    borderWidth: 1,
    borderColor: "#E2E8F0",
  },
  logoImage: { width: 136, height: 136, resizeMode: "contain" },
  brand: { color: "#0F172A", fontSize: 40, fontWeight: "900" },
  parentBrand: {
    color: "#0F766E",
    fontSize: 13,
    fontWeight: "900",
    marginTop: 4,
    textTransform: "uppercase",
  },
  subtitle: {
    color: "#64748B",
    fontSize: 16,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 10,
    marginBottom: 34,
  },
  button: {
    backgroundColor: "#1D4ED8",
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 15,
    minHeight: MIN_TOUCH_TARGET,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
  legalLink: { marginTop: 22, minHeight: MIN_TOUCH_TARGET, justifyContent: "center", paddingHorizontal: 8 },
  legalLinkText: { color: "#1D4ED8", fontWeight: "700", textDecorationLine: "underline" },
});
