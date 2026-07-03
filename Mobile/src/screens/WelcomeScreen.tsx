import { Animated, Image, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { useEffect, useRef } from "react";
import { SafeAreaView } from "react-native-safe-area-context";
import { RootStackParamList } from "../navigation/AppNavigator";

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
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <Animated.View style={[styles.logoBox, { opacity, transform: [{ scale }] }]}>
        <Image source={somafrikLogo} style={styles.logoImage} />
      </Animated.View>
      <Animated.Text style={[styles.brand, { opacity }]}>Somafrik</Animated.Text>
      <Animated.Text style={[styles.parentBrand, { opacity }]}>par Somafrik</Animated.Text>
      <Animated.Text style={[styles.subtitle, { opacity }]}>
        ERP scolaire mobile et tablette pour tous les rôles.
      </Animated.Text>
      <Animated.View style={{ transform: [{ translateY: buttonOffset }], opacity }}>
        <TouchableOpacity
          activeOpacity={0.86}
          style={styles.button}
          onPress={() => navigation.navigate("RoleSelection")}
        >
          <Text style={styles.buttonText}>Se connecter</Text>
          <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />
        </TouchableOpacity>
      </Animated.View>
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
    backgroundColor: "#2563EB",
    borderRadius: 18,
    paddingHorizontal: 22,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  buttonText: { color: "#FFFFFF", fontWeight: "900", fontSize: 16 },
});
