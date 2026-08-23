import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useAdminData } from "../context/AdminDataContext";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  getEducationSchoolCatalog,
  saveSchoolEducationActivation,
} from "../services/schoolSettingsApi";
import type { EducationSchoolCatalog } from "../services/api";

function toggleId(current: string[], id: string) {
  return current.includes(id) ? current.filter((value) => value !== id) : [...current, id];
}

export default function SchoolPedagogicalStructureScreen() {
  const { canOpen, canEdit } = useSchoolSettingsAccess("SchoolPedagogicalStructure");
  const { refreshBackOfficeState } = useAdminData();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();
  const [catalog, setCatalog] = useState<EducationSchoolCatalog | null>(null);
  const [selectedLevelIds, setSelectedLevelIds] = useState<string[]>([]);
  const [selectedStreamIds, setSelectedStreamIds] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await getEducationSchoolCatalog();
      setCatalog(response);
      setSelectedLevelIds((response.levels ?? []).filter((row) => row.schoolActive).map((row) => row.id));
      setSelectedStreamIds((response.streams ?? []).filter((row) => row.schoolActive).map((row) => row.id));
      setSelectedGroupIds((response.groups ?? []).filter((row) => row.schoolActive).map((row) => row.id));
    } catch (err) {
      setCatalog(null);
      setError(err instanceof Error ? err.message : "Impossible de charger le référentiel disponible.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const streamsByType = useMemo(() => {
    const groups: Record<string, EducationSchoolCatalog["streams"]> = { filiere: [], serie: [], option: [] };
    for (const stream of catalog?.streams ?? []) {
      const key = stream.streamType && groups[stream.streamType] ? stream.streamType : "filiere";
      groups[key].push(stream);
    }
    return groups;
  }, [catalog]);

  async function save() {
    if (!canEdit) {
      Alert.alert("Lecture seule", "Vous n’avez pas le droit de modifier l’activation pédagogique.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const saved = await saveSchoolEducationActivation({
        levelIds: selectedLevelIds,
        streamIds: selectedStreamIds,
        groupIds: selectedGroupIds,
      });
      setCatalog(saved);
      await refreshBackOfficeState();
      Alert.alert("Enregistré", "Structure pédagogique activée pour l’établissement.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement de l’activation refusé.");
    } finally {
      setSaving(false);
    }
  }

  if (!canOpen) return <SchoolSettingsDenied />;

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
      testID="school-pedagogical-structure"
    >
      <Text style={styles.title}>Structure pédagogique</Text>
      <Text style={styles.subtitle}>
        Référentiels disponibles pour votre établissement. Vous activez un sous-ensemble du catalogue national, sans le modifier.
      </Text>

      {loading ? <Text style={styles.meta}>Chargement…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      {!loading && !catalog ? (
        <Text style={styles.meta}>Référentiel indisponible.</Text>
      ) : null}

      {catalog ? (
        <>
          <Text style={styles.meta}>
            Pays de l’établissement : {catalog.countryCode || "—"}. Les libellés nationaux ne sont pas modifiables ici.
          </Text>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{catalog.labels?.levelLabel ?? "Niveau"}s disponibles</Text>
            {(catalog.levels ?? []).length ? (
              catalog.levels.map((level) => (
                <CheckRow
                  key={level.id}
                  label={level.name}
                  checked={selectedLevelIds.includes(level.id)}
                  disabled={!canEdit}
                  onToggle={() => setSelectedLevelIds((current) => toggleId(current, level.id))}
                />
              ))
            ) : (
              <Text style={styles.meta}>Aucun niveau défini pour ce pays. Contactez le Super administrateur ou l’Administrateur pays.</Text>
            )}
          </View>

          {(["filiere", "serie", "option"] as const).map((streamType) => (
            <View key={streamType} style={styles.card}>
              <Text style={styles.cardTitle}>
                {streamType === "filiere" ? "Filières" : streamType === "serie" ? "Séries" : "Options"}
              </Text>
              {streamsByType[streamType]?.length ? (
                streamsByType[streamType].map((stream) => (
                  <CheckRow
                    key={stream.id}
                    label={stream.name}
                    checked={selectedStreamIds.includes(stream.id)}
                    disabled={!canEdit}
                    onToggle={() => setSelectedStreamIds((current) => toggleId(current, stream.id))}
                  />
                ))
              ) : (
                <Text style={styles.meta}>Aucune entrée pour cette catégorie.</Text>
              )}
            </View>
          ))}

          <View style={styles.card}>
            <Text style={styles.cardTitle}>{catalog.labels?.groupLabel ?? "Groupe"}s disponibles</Text>
            {(catalog.groups ?? []).length ? (
              catalog.groups.map((group) => (
                <CheckRow
                  key={group.id}
                  label={group.name || group.code || group.id}
                  checked={selectedGroupIds.includes(group.id)}
                  disabled={!canEdit}
                  onToggle={() => setSelectedGroupIds((current) => toggleId(current, group.id))}
                />
              ))
            ) : (
              <Text style={styles.meta}>Aucun groupe défini pour ce pays. Contactez le Super administrateur ou l’Administrateur pays.</Text>
            )}
          </View>

          {canEdit ? (
            <TouchableOpacity
              style={styles.primary}
              onPress={() => void save()}
              disabled={saving}
              testID="school-activation-save"
              accessibilityRole="button"
            >
              <Text style={styles.primaryText}>{saving ? "Enregistrement…" : "Enregistrer l’activation"}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={styles.readOnly}>Lecture seule — l’activation n’est pas modifiable pour ce rôle.</Text>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

function CheckRow({
  label,
  checked,
  disabled,
  onToggle,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.checkRow}
      onPress={onToggle}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={label}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>{checked ? <Text style={styles.tick}>✓</Text> : null}</View>
      <Text style={styles.checkLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 26, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 10 },
  meta: { color: "#64748B", fontWeight: "600", marginBottom: 10 },
  error: { color: "#991B1B", fontWeight: "800", marginBottom: 12 },
  readOnly: { color: "#B45309", fontWeight: "700" },
  checkRow: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, marginBottom: 6 },
  box: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#94A3B8",
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  tick: { color: "#FFFFFF", fontWeight: "900", fontSize: 12 },
  checkLabel: { color: "#111827", fontWeight: "700", flex: 1 },
  primary: { backgroundColor: "#2563EB", borderRadius: 16, padding: 16, minHeight: 48, justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
});
