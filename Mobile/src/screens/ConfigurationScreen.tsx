import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import SchoolSelector from "../components/SchoolSelector";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { canReadView } from "../domain/security/permissions";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

type SettingsCard = {
  title: string;
  description: string;
  route: "EstablishmentProfile" | "SchoolYearSettings" | "SchoolPedagogicalStructure" | "SchoolAssignableRoles" | "Users";
  view: string;
};

const sections: SettingsCard[] = [
  {
    title: "Profil établissement",
    description: "Identité, contacts et responsable légal.",
    route: "EstablishmentProfile",
    view: "EstablishmentProfile",
  },
  {
    title: "Année scolaire",
    description: "Années, périodes, barème, mode de bulletin et types d’évaluation.",
    route: "SchoolYearSettings",
    view: "SchoolYearSettings",
  },
  {
    title: "Structure pédagogique",
    description: "Niveaux, filières, groupes et cours configurés par classe.",
    route: "SchoolPedagogicalStructure",
    view: "SchoolPedagogicalStructure",
  },
  {
    title: "Rôles disponibles",
    description: "Catalogue des rôles affectables — lecture seule.",
    route: "SchoolAssignableRoles",
    view: "SchoolAssignableRoles",
  },
  {
    title: "Utilisateurs",
    description: "Comptes et affectations de rôles de l’établissement.",
    route: "Users",
    view: "users",
  },
];

export default function ConfigurationScreen() {
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const { canOpen, canEdit } = useSchoolSettingsAccess("Configuration");
  const { academicConfigData, availableSchools, activeSchoolCode } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth, columns } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();

  if (!canOpen) {
    return <SchoolSettingsDenied />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{
        padding: horizontalPadding,
        paddingBottom: bottomPadding,
        maxWidth: contentMaxWidth,
        alignSelf: "center",
        width: "100%",
      }}
    >
      <Text style={styles.title}>Paramètres</Text>
      <Text style={styles.subtitle}>
        Configuration de l’établissement alignée sur l’interface Web. Même source PostgreSQL, mêmes droits.
      </Text>

      <SchoolSelector />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Périmètre actif</Text>
        <Text style={styles.summaryText}>
          {activeSchoolCode === "*"
            ? `${availableSchools.length} établissement(s)`
            : availableSchools.find((school) => school.code === activeSchoolCode)?.name ?? activeSchoolCode}
        </Text>
        <Text style={styles.summaryMeta}>
          {academicConfigData.schoolCode
            ? `Organisation : ${academicConfigData.periodMode} • Échelle : /${academicConfigData.defaultScale}`
            : "Configuration établissement non chargée."}
        </Text>
        <Text style={styles.summaryMeta}>
          Périodes : {academicConfigData.periods?.length ?? 0} • Cours : {academicConfigData.subjects?.length ?? 0}
        </Text>
        {!canEdit && (
          <Text style={styles.readOnly}>Lecture seule — un droit de modification est requis pour enregistrer.</Text>
        )}
      </View>

      <View style={[styles.grid, isTablet && { flexDirection: "row", flexWrap: "wrap" }]}>
        {sections.map((section) => {
          if (!canReadView(session, section.view)) return null;
          return (
            <TouchableOpacity
              key={section.title}
              style={[styles.card, isTablet && { width: `${100 / columns - 2}%`, minWidth: 280 }]}
              onPress={() => navigation.navigate(section.route)}
              accessibilityRole="button"
              accessibilityLabel={section.title}
              testID={`settings-card-${section.route}`}
            >
              <Text style={styles.cardTitle}>{section.title}</Text>
              <Text style={styles.cardDescription}>{section.description}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  summaryCard: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, marginBottom: 16 },
  summaryTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  summaryText: { color: "#2563EB", fontWeight: "700", marginTop: 6 },
  summaryMeta: { color: "#64748B", marginTop: 4, fontWeight: "600" },
  readOnly: { color: "#B45309", marginTop: 10, fontWeight: "700" },
  grid: { gap: 12 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 18, marginBottom: 12 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 6 },
  cardDescription: { color: "#64748B", lineHeight: 20 },
});
