import { useCallback, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useAuth } from "../context/AuthContext";
import CanonicalMutationModal from "./CanonicalMutationModal";
import ChoiceChips from "./ChoiceChips";
import { resolveEntityCrudAccess } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { OFFLINE_COPY } from "../lib/offlineModeSpec";
import {
  createSchoolClass,
  getAcademicYears,
  getEducationCatalog,
  updateSchoolClass,
  type AcademicYearOption,
  type EducationSchoolCatalog,
} from "../services/api";

type ClassRow = {
  id?: string;
  name?: string;
  classCode?: string;
  publicId?: string;
  status?: string;
  academicYearId?: string;
  levelId?: string | null;
  streamId?: string | null;
  groupId?: string | null;
};

function asId(value: unknown): string {
  return String(value ?? "").trim();
}

export default function ClassMutationControls({
  row,
  networkRequired = false,
  onBlockedMutation,
  onChanged,
}: {
  row?: ClassRow;
  networkRequired?: boolean;
  onBlockedMutation?: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { session } = useAuth();
  const access = resolveEntityCrudAccess(session, "classes");
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [years, setYears] = useState<AcademicYearOption[]>([]);
  const [catalog, setCatalog] = useState<EducationSchoolCatalog | null>(null);
  const [academicYearId, setAcademicYearId] = useState("");
  const [levelId, setLevelId] = useState("");
  const [streamId, setStreamId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [status, setStatus] = useState<"active" | "inactive">("active");
  const editing = Boolean(row);

  const loadLookups = useCallback(async () => {
    const [yearRows, schoolCatalog] = await Promise.all([
      getAcademicYears().catch(() => [] as AcademicYearOption[]),
      getEducationCatalog(),
    ]);
    setYears(yearRows);
    setCatalog(schoolCatalog);
    return { yearRows, schoolCatalog };
  }, []);

  const refuseIfOffline = () => {
    onBlockedMutation?.();
    Alert.alert("Hors ligne", OFFLINE_COPY.mutationRequiresConnection);
  };

  const openCreate = async () => {
    if (networkRequired) {
      refuseIfOffline();
      return;
    }
    if (!access.canCreate) return;
    setError("");
    try {
      const { yearRows, schoolCatalog } = await loadLookups();
      const current = yearRows.find((year) => year.isCurrent) ?? yearRows[0];
      const levels = (schoolCatalog.levels ?? []).filter((item) => item.schoolActive);
      const groups = (schoolCatalog.groups ?? []).filter((item) => item.schoolActive);
      setAcademicYearId(asId(current?.id));
      setLevelId(asId(levels[0]?.id));
      setStreamId("");
      setGroupId(asId(groups[0]?.id));
      setStatus("active");
      setOpen(true);
    } catch (err) {
      Alert.alert(
        "Création impossible",
        err instanceof Error ? err.message : "Référentiel classes indisponible. Aucune classe n'a été créée.",
      );
    }
  };

  const openEdit = async () => {
    if (networkRequired) {
      refuseIfOffline();
      return;
    }
    if (!access.canUpdate || !row) return;
    setError("");
    try {
      await loadLookups();
      setAcademicYearId(asId(row.academicYearId));
      setLevelId(asId(row.levelId));
      setStreamId(asId(row.streamId));
      setGroupId(asId(row.groupId));
      setStatus(String(row.status ?? "active") === "inactive" ? "inactive" : "active");
      setOpen(true);
    } catch (err) {
      Alert.alert(
        "Modification impossible",
        err instanceof Error ? err.message : "Référentiel classes indisponible.",
      );
    }
  };

  const submit = async () => {
    if (saving) return;
    if (!editing && (!academicYearId || !levelId || !groupId)) {
      setError("Année, niveau et groupe sont obligatoires.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (editing) {
        const classCode = asId(row?.classCode || row?.publicId);
        if (!classCode) throw new Error("Code classe manquant.");
        await updateSchoolClass(classCode, {
          status,
          ...(levelId ? { levelId, streamId: streamId || null, groupId } : {}),
        });
      } else {
        await createSchoolClass({
          academicYearId,
          levelId,
          streamId: streamId || null,
          groupId,
          status,
        });
      }
      setOpen(false);
      await onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enregistrement impossible.");
    } finally {
      setSaving(false);
    }
  };

  const deactivate = () => {
    if (networkRequired) {
      refuseIfOffline();
      return;
    }
    if (!access.canUpdate || !row) return;
    const classCode = asId(row.classCode || row.publicId);
    Alert.alert("Désactiver la classe", `${row.name ?? classCode} passera inactive côté serveur.`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Désactiver",
        style: "destructive",
        onPress: async () => {
          try {
            await updateSchoolClass(classCode, { status: "inactive" });
            await onChanged();
          } catch (err) {
            Alert.alert("Désactivation impossible", err instanceof Error ? err.message : "Échec serveur.");
          }
        },
      },
    ]);
  };

  const levels = (catalog?.levels ?? []).filter((item) => item.schoolActive);
  const streams = (catalog?.streams ?? []).filter((item) => {
    if (!item.schoolActive) return false;
    if (!levelId || !item.levelId) return true;
    return item.levelId === levelId;
  });
  const groups = (catalog?.groups ?? []).filter((item) => item.schoolActive);
  const labels = catalog?.labels ?? { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Groupe" };

  if (row) {
    if (!access.canUpdate) return null;
    return (
      <View style={styles.row}>
        <TouchableOpacity style={styles.small} onPress={() => void openEdit()} accessibilityRole="button" accessibilityLabel="Modifier la classe">
          <Text style={styles.smallText}>Modifier</Text>
        </TouchableOpacity>
        {String(row.status ?? "active") !== "inactive" ? (
          <TouchableOpacity style={styles.smallDanger} onPress={deactivate} accessibilityRole="button" accessibilityLabel="Désactiver la classe">
            <Text style={styles.smallDangerText}>Désactiver</Text>
          </TouchableOpacity>
        ) : null}
        <CanonicalMutationModal
          visible={open}
          title="Modifier la classe"
          error={error}
          saving={saving}
          onClose={() => setOpen(false)}
          onSubmit={() => void submit()}
        >
          <ChoiceChips
            label={labels.levelLabel || "Niveau"}
            options={levels.map((item) => ({ id: item.id, label: item.name }))}
            selectedId={levelId}
            onSelect={setLevelId}
            disabled={saving}
          />
          <ChoiceChips
            label={labels.trackLabel || "Filière"}
            options={[{ id: "", label: "Aucune" }, ...streams.map((item) => ({ id: item.id, label: item.name }))]}
            selectedId={streamId}
            onSelect={setStreamId}
            disabled={saving}
          />
          <ChoiceChips
            label={labels.groupLabel || "Groupe"}
            options={groups.map((item) => ({ id: item.id, label: item.name }))}
            selectedId={groupId}
            onSelect={setGroupId}
            disabled={saving}
          />
          <ChoiceChips
            label="Statut"
            options={[
              { id: "active", label: "Actif" },
              { id: "inactive", label: "Inactif" },
            ]}
            selectedId={status}
            onSelect={(id) => setStatus(id as "active" | "inactive")}
            disabled={saving}
          />
        </CanonicalMutationModal>
      </View>
    );
  }

  if (!access.canCreate) return null;
  return (
    <>
      <TouchableOpacity
        style={styles.create}
        onPress={() => void openCreate()}
        testID="classes-create"
        accessibilityRole="button"
        accessibilityLabel="Créer une classe"
      >
        <Text style={styles.createText}>Créer une classe</Text>
      </TouchableOpacity>
      <CanonicalMutationModal
        visible={open}
        title="Créer une classe"
        error={error}
        saving={saving}
        submitDisabled={!academicYearId || !levelId || !groupId}
        onClose={() => setOpen(false)}
        onSubmit={() => void submit()}
      >
        {!years.length ? (
          <Text style={styles.hint}>Aucune année scolaire chargeable. Configurez-la sur le Web, puis réessayez.</Text>
        ) : (
          <ChoiceChips
            label="Année scolaire"
            options={years.map((item) => ({ id: item.id, label: item.name }))}
            selectedId={academicYearId}
            onSelect={setAcademicYearId}
            disabled={saving}
          />
        )}
        <ChoiceChips
          label={labels.levelLabel || "Niveau"}
          options={levels.map((item) => ({ id: item.id, label: item.name }))}
          selectedId={levelId}
          onSelect={setLevelId}
          disabled={saving}
        />
        <ChoiceChips
          label={labels.trackLabel || "Filière"}
          options={[{ id: "", label: "Aucune" }, ...streams.map((item) => ({ id: item.id, label: item.name }))]}
          selectedId={streamId}
          onSelect={setStreamId}
          disabled={saving}
        />
        <ChoiceChips
          label={labels.groupLabel || "Groupe"}
          options={groups.map((item) => ({ id: item.id, label: item.name }))}
          selectedId={groupId}
          onSelect={setGroupId}
          disabled={saving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  create: {
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 14,
  },
  createText: { color: "#FFFFFF", fontWeight: "900" },
  row: { flexDirection: "row", gap: 8, marginTop: 8, flexWrap: "wrap" },
  small: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#E2E8F0",
    justifyContent: "center",
  },
  smallText: { color: "#0F172A", fontWeight: "800" },
  smallDanger: {
    minHeight: MIN_TOUCH_TARGET_DP,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    justifyContent: "center",
  },
  smallDangerText: { color: "#B91C1C", fontWeight: "800" },
  hint: { color: "#B45309", fontWeight: "700", marginBottom: 8 },
});
