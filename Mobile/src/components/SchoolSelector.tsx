import React from "react";
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { useAdminData } from "../context/AdminDataContext";
import { ALL_SCHOOLS_CODE, schoolSelectorChoice } from "../lib/activeSchool";

export default function SchoolSelector() {
  const {
    requiresSchoolSelection,
    availableSchools,
    activeSchoolCode,
    setActiveSchoolCode,
  } = useAdminData();

  if (!requiresSchoolSelection || availableSchools.length <= 1) {
    return null;
  }

  const options = [
    { code: ALL_SCHOOLS_CODE, label: "Tous les etablissements" },
    ...availableSchools.map((school) => schoolSelectorChoice(school)),
  ];

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Etablissement actif</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {options.map((option) => {
          const active = activeSchoolCode === option.code || (!activeSchoolCode && option.code === ALL_SCHOOLS_CODE);
          return (
            <TouchableOpacity
              key={option.code}
              style={[styles.chip, active && styles.chipActive]}
              onPress={() => setActiveSchoolCode(option.code)}
            >
              <Text style={[styles.chipText, active && styles.chipTextActive]} numberOfLines={1}>
                {option.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: "700", color: "#64748B", marginBottom: 8 },
  row: { gap: 8, paddingRight: 8 },
  chip: {
    backgroundColor: "#FFFFFF",
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "#E2E8F0",
    maxWidth: 280,
  },
  chipActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "600", fontSize: 13 },
  chipTextActive: { color: "#FFFFFF" },
});
