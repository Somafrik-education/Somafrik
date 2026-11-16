import React, { useEffect, useState } from "react";
import { Image, StyleSheet, Text, View, type ImageStyle, type StyleProp } from "react-native";
import { getApiBaseUrl } from "../services/api";
import { schoolLogoDisplayUri, schoolLogoInitials, type SchoolLogoSource } from "../lib/schoolLogo";

type Props = {
  school: (SchoolLogoSource & { name?: string }) | null | undefined;
  size: number;
  imageStyle?: StyleProp<ImageStyle>;
  imageTestID?: string;
  fallbackTestID?: string;
};

/**
 * AUTH-MOBILE-01 — logo d'établissement avec remplacement : initiales si l'établissement
 * n'a pas de logo publié ou si l'image ne se charge pas (404, réseau). Jamais de logo plateforme.
 */
export default function SchoolLogoMark({ school, size, imageStyle, imageTestID, fallbackTestID }: Props) {
  const uri = schoolLogoDisplayUri(school, getApiBaseUrl());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [uri]);

  if (uri && !failed) {
    return (
      <Image
        source={{ uri }}
        style={imageStyle}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
        testID={imageTestID}
      />
    );
  }

  return (
    <View
      style={[styles.fallback, { width: size, height: size, borderRadius: Math.round(size / 4) }]}
      testID={fallbackTestID}
      accessible
      accessibilityLabel={school?.name ? `Établissement ${school.name}` : "Établissement"}
    >
      <Text style={[styles.initials, { fontSize: Math.max(10, Math.round(size * 0.38)) }]}>
        {schoolLogoInitials(school?.name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: "#EFF6FF",
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    color: "#1D4ED8",
    fontWeight: "900",
  },
});
