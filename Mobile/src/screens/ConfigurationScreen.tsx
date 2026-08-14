import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import SchoolSelector from "../components/SchoolSelector";
import { canReadView, hasSecurityPermission } from "../domain/security/permissions";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";

type ConfigSection = {
  title: string;
  description: string;
  route?: string;
  entity?: string;
  view: string;
};

const sections: ConfigSection[] = [
  {
    title: "Periodes academiques",
    description: "Trimestres, semestres et periode active.",
    view: "configuration",
  },
  {
    title: "Niveaux et filieres",
    description: "Listes pedagogiques de l etablissement.",
    view: "configuration",
  },
  {
    title: "Classes et matieres",
    description: "Referentiels utilises dans les cours et notes.",
    entity: "classes",
    view: "classes",
  },
  {
    title: "Utilisateurs et roles",
    description: "Comptes internes et pilotage local des droits.",
    entity: "users",
    view: "users",
  },
  {
    title: "Statuts de paiement",
    description: "Parametres financiers de l etablissement.",
    entity: "paymentStatuses",
    view: "configuration",
  },
];

export default function ConfigurationScreen() {
  const navigation = useNavigation<any>();
  const { session } = useAuth();
  const { academicConfigData, availableSchools, activeSchoolCode } = useAdminData();
  const { isTablet, horizontalPadding, contentMaxWidth, columns } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();

  if (!canReadView(session, "Configuration")) {
    return (
      <View style={styles.denied}>
        <Text style={styles.deniedText}>Acces configuration non autorise pour ce role.</Text>
      </View>
    );
  }

  const canEditSettings = hasSecurityPermission(session, "Paramètres Établissement", "UPDATE");

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
      <Text style={styles.title}>Configuration</Text>
      <Text style={styles.subtitle}>
        Hub etablissement aligne web v13 — periodes, referentiels et pilotage local.
      </Text>

      <SchoolSelector />

      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>Perimetre actif</Text>
        <Text style={styles.summaryText}>
          {activeSchoolCode === "*"
            ? `${availableSchools.length} etablissement(s)`
            : availableSchools.find((school) => school.code === activeSchoolCode)?.name ?? activeSchoolCode}
        </Text>
        <Text style={styles.summaryMeta}>
          {academicConfigData.schoolCode
            ? `Mode : ${academicConfigData.periodMode} • Echelle : /${academicConfigData.defaultScale}`
            : "Configuration établissement non chargée."}
        </Text>
        <Text style={styles.summaryMeta}>
          Periodes : {academicConfigData.periods?.length ?? 0} • Matieres : {academicConfigData.subjects?.length ?? 0}
        </Text>
        {!canEditSettings && (
          <Text style={styles.readOnly}>Lecture seule — droits Parametres Etablissement requis pour modifier.</Text>
        )}
      </View>

      <View style={[styles.grid, isTablet && { flexDirection: "row", flexWrap: "wrap" }]}>
        {sections.map((section) => {
          if (!canReadView(session, section.view)) return null;
          return (
            <TouchableOpacity
              key={section.title}
              style={[styles.card, isTablet && { width: `${100 / columns - 2}%`, minWidth: 280 }]}
              onPress={() => {
                if (section.entity) {
                  navigation.navigate("AdminCrud", { entity: section.entity });
                  return;
                }
                if (section.route) {
                  navigation.navigate(section.route);
                }
              }}
            >
              <Text style={styles.cardTitle}>{section.title}</Text>
              <Text style={styles.cardDescription}>{section.description}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {session?.role === "school_admin" && (
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => navigation.navigate("Utilisateurs")}
        >
          <Text style={styles.primaryBtnText}>Pilotage des droits (Utilisateurs)</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 28, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  summaryCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    marginBottom: 16,
  },
  summaryTitle: { fontSize: 16, fontWeight: "800", color: "#111827" },
  summaryText: { color: "#2563EB", fontWeight: "700", marginTop: 6 },
  summaryMeta: { color: "#64748B", marginTop: 4, fontWeight: "600" },
  readOnly: { color: "#B45309", marginTop: 10, fontWeight: "700" },
  grid: { gap: 12 },
  card: {
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    marginBottom: 12,
  },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 6 },
  cardDescription: { color: "#64748B", lineHeight: 20 },
  primaryBtn: { backgroundColor: "#2563EB", borderRadius: 16, padding: 16, marginTop: 8 },
  primaryBtnText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
  denied: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  deniedText: { color: "#64748B", fontWeight: "700", textAlign: "center" },
});
