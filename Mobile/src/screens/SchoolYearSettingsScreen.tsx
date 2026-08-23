import { useCallback, useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import FormField from "../components/FormField";
import ChoiceChips from "../components/ChoiceChips";
import { SchoolSettingsDenied, useSchoolSettingsAccess } from "../components/SchoolSettingsGate";
import { useAdminData } from "../context/AdminDataContext";
import { useResponsiveLayout } from "../hooks/useResponsiveLayout";
import { useStackScreenBottomPadding } from "../lib/screenLayout";
import {
  coercePeriodMode,
  defaultPeriodsForMode,
  normalizeStoredPeriods,
  serializePeriods,
  type AcademicPeriodRow,
  type PeriodMode,
} from "../lib/schoolAcademicPeriods";
import {
  archiveEvaluationType,
  createAcademicYear,
  createEvaluationType,
  getSchoolSettings,
  listAcademicYears,
  listEvaluationTypes,
  patchSchoolSettings,
  replaceAcademicPeriods,
  updateAcademicYear,
  type AcademicYearRecord,
} from "../services/schoolSettingsApi";
import type { CanonicalEvaluationType } from "../services/api";

export default function SchoolYearSettingsScreen() {
  const { canOpen, canEdit } = useSchoolSettingsAccess("SchoolYearSettings");
  const { academicConfigData, refreshBackOfficeState } = useAdminData();
  const { horizontalPadding, contentMaxWidth } = useResponsiveLayout();
  const bottomPadding = useStackScreenBottomPadding();

  const [years, setYears] = useState<AcademicYearRecord[]>([]);
  const [types, setTypes] = useState<CanonicalEvaluationType[]>([]);
  const [periodMode, setPeriodMode] = useState<PeriodMode>("trimestre");
  const [periodRows, setPeriodRows] = useState<AcademicPeriodRow[]>([]);
  const [defaultScale, setDefaultScale] = useState("20");
  const [reportCardMode, setReportCardMode] = useState("period");
  const [yearDraft, setYearDraft] = useState({ name: "", startDate: "", endDate: "", isCurrent: true });
  const [typeName, setTypeName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [settings, yearRows, typePayload] = await Promise.all([
        getSchoolSettings(),
        listAcademicYears(),
        listEvaluationTypes(),
      ]);
      const mode = coercePeriodMode(settings.periodMode || academicConfigData.periodMode);
      setPeriodMode(mode);
      setPeriodRows(normalizeStoredPeriods(settings.periods ?? academicConfigData.periods, mode));
      setDefaultScale(String(settings.defaultScale || academicConfigData.defaultScale || 20));
      setReportCardMode(String(settings.reportCardMode || academicConfigData.reportCardMode || "period"));
      setYears(yearRows);
      setTypes((typePayload.types ?? []).filter((row) => row.status === "active"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible de charger les paramètres scolaires.");
    } finally {
      setLoading(false);
    }
  }, [academicConfigData.defaultScale, academicConfigData.periodMode, academicConfigData.periods, academicConfigData.reportCardMode]);

  useEffect(() => {
    void load();
  }, [load]);

  function changePeriodMode(next: PeriodMode) {
    setPeriodMode(next);
    setPeriodRows(defaultPeriodsForMode(next));
  }

  async function savePeriods() {
    if (!canEdit) return;
    if (!years.length) {
      Alert.alert("Année manquante", "Créez une année scolaire avant d’enregistrer les périodes.");
      return;
    }
    const periods = serializePeriods(periodRows, periodMode);
    if (!periods.length) {
      Alert.alert("Périodes", "Ajoutez au moins une sous-période.");
      return;
    }
    const scale = Number(defaultScale);
    if (!Number.isFinite(scale) || scale <= 0) {
      Alert.alert("Barème", "Le barème par défaut doit être un nombre supérieur à 0.");
      return;
    }
    setSaving("periods");
    setError("");
    try {
      await patchSchoolSettings({ periodMode, defaultScale: scale, reportCardMode });
      await replaceAcademicPeriods(periods);
      await refreshBackOfficeState();
      Alert.alert("Enregistré", "Périodes, barème et mode de bulletin mis à jour.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement des périodes refusé.");
    } finally {
      setSaving("");
    }
  }

  async function createYear() {
    if (!canEdit) return;
    if (!yearDraft.name.trim() || !yearDraft.startDate.trim() || !yearDraft.endDate.trim()) {
      Alert.alert("Année scolaire", "Nom, date de début et date de fin sont obligatoires.");
      return;
    }
    setSaving("year");
    setError("");
    try {
      await createAcademicYear({
        name: yearDraft.name.trim(),
        startDate: yearDraft.startDate.trim(),
        endDate: yearDraft.endDate.trim(),
        isCurrent: yearDraft.isCurrent,
      });
      setYearDraft({ name: "", startDate: "", endDate: "", isCurrent: true });
      await refreshBackOfficeState();
      await load();
      Alert.alert("Enregistré", "Année scolaire créée.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création d’année refusée.");
    } finally {
      setSaving("");
    }
  }

  async function setCurrentYear(id: string) {
    if (!canEdit) return;
    setSaving("year");
    try {
      await updateAcademicYear(id, { isCurrent: true });
      await refreshBackOfficeState();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mise à jour de l’année refusée.");
    } finally {
      setSaving("");
    }
  }

  async function createType() {
    if (!canEdit || !typeName.trim()) return;
    setSaving("types");
    try {
      await createEvaluationType({ name: typeName.trim() });
      setTypeName("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Création du type refusée.");
    } finally {
      setSaving("");
    }
  }

  async function archiveType(typeId: string) {
    if (!canEdit) return;
    setSaving("types");
    try {
      await archiveEvaluationType(typeId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archivage refusé.");
    } finally {
      setSaving("");
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
    >
      <Text style={styles.title}>Année scolaire</Text>
      <Text style={styles.subtitle}>
        Années, périodes, barème et types d’évaluation. Les écritures passent par les API PostgreSQL, jamais par la configuration académique héritée.
      </Text>

      {loading ? <Text style={styles.meta}>Chargement…</Text> : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Années</Text>
        {years.length ? (
          years.map((year) => (
            <View key={year.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{year.name}</Text>
                <Text style={styles.meta}>
                  {year.startDate} → {year.endDate}
                  {year.isCurrent ? " • année courante" : ""}
                </Text>
              </View>
              {canEdit && !year.isCurrent ? (
                <TouchableOpacity onPress={() => void setCurrentYear(year.id)} accessibilityRole="button">
                  <Text style={styles.link}>Définir comme courante</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.meta}>Aucune année configurée.</Text>
        )}
        {canEdit ? (
          <View style={{ marginTop: 12 }}>
            <FormField label="Nom de l’année" required value={yearDraft.name} onChangeText={(name) => setYearDraft((current) => ({ ...current, name }))} placeholder="2026-2027" />
            <FormField label="Début" type="date" required value={yearDraft.startDate} onChangeText={(startDate) => setYearDraft((current) => ({ ...current, startDate }))} placeholder="AAAA-MM-JJ" />
            <FormField label="Fin" type="date" required value={yearDraft.endDate} onChangeText={(endDate) => setYearDraft((current) => ({ ...current, endDate }))} placeholder="AAAA-MM-JJ" />
            <ChoiceChips
              label="Année courante"
              selectedId={yearDraft.isCurrent ? "yes" : "no"}
              onSelect={(id) => setYearDraft((current) => ({ ...current, isCurrent: id === "yes" }))}
              options={[
                { id: "yes", label: "Oui" },
                { id: "no", label: "Non" },
              ]}
            />
            <TouchableOpacity style={styles.secondary} onPress={() => void createYear()} disabled={saving === "year"}>
              <Text style={styles.secondaryText}>{saving === "year" ? "Enregistrement…" : "Créer l’année"}</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Périodes, barème et bulletin</Text>
        <ChoiceChips
          label="Mode de période"
          selectedId={periodMode}
          onSelect={(id) => changePeriodMode(id as PeriodMode)}
          options={[
            { id: "trimestre", label: "Trimestre" },
            { id: "semestre", label: "Semestre" },
            { id: "periode", label: "Périodes personnalisées" },
          ]}
          disabled={!canEdit}
        />
        <FormField label="Barème par défaut" type="amount" value={defaultScale} onChangeText={setDefaultScale} editable={canEdit} />
        <ChoiceChips
          label="Mode de bulletin"
          selectedId={reportCardMode}
          onSelect={setReportCardMode}
          options={[
            { id: "period", label: "Par période" },
            { id: "annual", label: "Annuel" },
            { id: "custom", label: "Personnalisé" },
          ]}
          disabled={!canEdit}
        />
        {periodRows.map((row, index) => (
          <View key={`${periodMode}-${index}`} style={styles.periodBox}>
            <FormField
              label={`Nom (${index + 1})`}
              value={row.name}
              onChangeText={(name) =>
                setPeriodRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, name } : item)))
              }
              editable={canEdit}
            />
            <FormField
              label="Début"
              value={row.startDate}
              onChangeText={(startDate) =>
                setPeriodRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, startDate } : item)))
              }
              editable={canEdit}
              placeholder="JJ-MM-AAAA"
            />
            <FormField
              label="Fin"
              value={row.endDate}
              onChangeText={(endDate) =>
                setPeriodRows((current) => current.map((item, itemIndex) => (itemIndex === index ? { ...item, endDate } : item)))
              }
              editable={canEdit}
              placeholder="JJ-MM-AAAA"
            />
            {periodMode === "periode" && canEdit ? (
              <TouchableOpacity
                onPress={() => setPeriodRows((current) => current.filter((_, itemIndex) => itemIndex !== index))}
              >
                <Text style={styles.link}>Retirer</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
        {periodMode === "periode" && canEdit ? (
          <TouchableOpacity
            onPress={() =>
              setPeriodRows((current) => [
                ...current,
                {
                  name: `Période ${current.length + 1}`,
                  type: "Période",
                  startDate: "",
                  endDate: "",
                  active: false,
                  order: current.length + 1,
                },
              ])
            }
          >
            <Text style={styles.link}>Ajouter une sous-période</Text>
          </TouchableOpacity>
        ) : null}
        {canEdit ? (
          <TouchableOpacity style={styles.primary} onPress={() => void savePeriods()} disabled={saving === "periods"} testID="school-periods-save">
            <Text style={styles.primaryText}>{saving === "periods" ? "Enregistrement…" : "Enregistrer les périodes"}</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Types d’évaluation</Text>
        {types.length ? (
          types.map((type) => (
            <View key={type.id} style={styles.row}>
              <Text style={styles.rowTitle}>{type.name}</Text>
              {canEdit ? (
                <TouchableOpacity onPress={() => void archiveType(type.id)}>
                  <Text style={styles.link}>Archiver</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ))
        ) : (
          <Text style={styles.meta}>Aucun type actif.</Text>
        )}
        {canEdit ? (
          <>
            <FormField label="Nouveau type" value={typeName} onChangeText={setTypeName} />
            <TouchableOpacity style={styles.secondary} onPress={() => void createType()} disabled={saving === "types"}>
              <Text style={styles.secondaryText}>Ajouter le type</Text>
            </TouchableOpacity>
          </>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  title: { fontSize: 26, fontWeight: "800", color: "#111827" },
  subtitle: { color: "#64748B", marginTop: 6, marginBottom: 16, lineHeight: 20 },
  card: { backgroundColor: "#FFFFFF", borderRadius: 18, padding: 16, marginBottom: 14 },
  cardTitle: { fontSize: 16, fontWeight: "800", color: "#111827", marginBottom: 10 },
  row: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  rowTitle: { fontWeight: "800", color: "#111827" },
  meta: { color: "#64748B", fontWeight: "600" },
  error: { color: "#991B1B", fontWeight: "800", marginBottom: 12 },
  link: { color: "#2563EB", fontWeight: "800" },
  periodBox: { borderWidth: 1, borderColor: "#E2E8F0", borderRadius: 14, padding: 10, marginBottom: 10 },
  primary: { backgroundColor: "#2563EB", borderRadius: 16, padding: 16, marginTop: 8, minHeight: 48, justifyContent: "center" },
  primaryText: { color: "#FFFFFF", fontWeight: "800", textAlign: "center" },
  secondary: { borderWidth: 1, borderColor: "#2563EB", borderRadius: 16, padding: 14, marginTop: 4, minHeight: 48, justifyContent: "center" },
  secondaryText: { color: "#2563EB", fontWeight: "800", textAlign: "center" },
});
