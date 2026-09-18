import { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import ExpandableEntityCard from "../components/ExpandableEntityCard";
import { useAuth } from "../context/AuthContext";
import {
  canArchiveExams,
  canCreateExams,
  canReadExams,
  canUpdateExams,
  canValidateExams,
} from "../lib/examPermissions";
import { formatDateForDisplay, toApiDate } from "../lib/dates";
import { nextExclusiveExpandedKey } from "../lib/expandableEntity";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  archiveExam,
  cancelExam,
  createExam,
  getExam,
  listExams,
  patchExam,
  validateExam,
  type CanonicalExam,
} from "../services/api";

type LoadStatus = "idle" | "loading" | "success" | "empty" | "unauthenticated" | "forbidden" | "offline" | "error";

function classifyFailure(error: unknown): { status: LoadStatus; message: string } {
  const statusCode =
    error && typeof error === "object" && "status" in error
      ? Number((error as { status?: unknown }).status)
      : undefined;
  if (statusCode === 401) {
    return { status: "unauthenticated", message: "Session expirée. Reconnectez-vous pour consulter les examens." };
  }
  if (statusCode === 403) {
    return { status: "forbidden", message: "Accès refusé. Le droit Examens est requis." };
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  const normalized = message.toLowerCase();
  const offline =
    statusCode === 0 ||
    normalized.includes("hors ligne") ||
    normalized.includes("network") ||
    normalized.includes("connexion") ||
    normalized.includes("serveur injoignable");
  return offline
    ? { status: "offline", message: "Connexion requise pour les examens. Aucune action hors ligne." }
    : { status: "error", message: message.trim() || "Impossible de charger les examens." };
}

function newIdempotencyKey() {
  return `exam-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const EMPTY_FORM = { name: "", className: "", subject: "", date: "", period: "", examType: "" };

export default function ExamsScreen() {
  const { session } = useAuth();
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const canRead = canReadExams(session);
  const canCreate = canCreateExams(session);
  const canUpdate = canUpdateExams(session);
  const canValidate = canValidateExams(session);
  const canArchive = canArchiveExams(session);
  const [status, setStatus] = useState<LoadStatus>(canRead ? "idle" : "forbidden");
  const [errorMessage, setErrorMessage] = useState("");
  const [rows, setRows] = useState<CanonicalExam[]>([]);
  const [details, setDetails] = useState<Record<string, CanonicalExam>>({});
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!canRead) {
      setStatus("forbidden");
      setErrorMessage("Accès refusé. Le droit Examens est requis.");
      setRows([]);
      return;
    }
    setStatus("loading");
    setErrorMessage("");
    try {
      const exams = await listExams();
      setRows(exams);
      setStatus(exams.length ? "success" : "empty");
    } catch (error) {
      const failure = classifyFailure(error);
      setRows([]);
      setStatus(failure.status);
      setErrorMessage(failure.message);
    }
  }, [canRead]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
    }, [refresh]),
  );

  const classOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.className ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
    [rows],
  );
  const periodOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.period ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
    [rows],
  );
  const statusOptions = useMemo(
    () => [...new Set(rows.map((row) => String(row.status ?? "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr")),
    [rows],
  );

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (classFilter && String(row.className ?? "") !== classFilter) return false;
      if (periodFilter && String(row.period ?? "") !== periodFilter) return false;
      if (statusFilter && String(row.status ?? "") !== statusFilter) return false;
      if (!needle) return true;
      return [row.name, row.className, row.subject, row.period, row.status].some((value) =>
        String(value ?? "").toLowerCase().includes(needle),
      );
    });
  }, [rows, search, classFilter, periodFilter, statusFilter]);

  const loadDetail = async (examId: string, expanded: boolean) => {
    if (!expanded || details[examId]) return;
    try {
      const exam = await getExam(examId);
      setDetails((current) => ({ ...current, [exam.id]: exam }));
    } catch (error) {
      const failure = classifyFailure(error);
      Alert.alert("Examen", failure.message);
    }
  };

  const runMutation = async (action: () => Promise<unknown>, confirm: string) => {
    if (status === "offline") {
      Alert.alert("Hors ligne", "Les examens sont online-only. Reconnectez-vous.");
      return;
    }
    Alert.alert("Confirmer", confirm, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Continuer",
        onPress: () => {
          void (async () => {
            setBusy(true);
            try {
              await action();
              setDetails({});
              await refresh();
            } catch (error) {
              const failure = classifyFailure(error);
              Alert.alert("Examen", failure.message);
              if (failure.status === "offline") {
                setStatus("offline");
                setErrorMessage(failure.message);
              }
            } finally {
              setBusy(false);
            }
          })();
        },
      },
    ]);
  };

  const submitCreate = () => {
    if (!canCreate) return;
    const apiDate = toApiDate(form.date.trim()) || form.date.trim();
    void runMutation(
      () =>
        createExam(
          {
            name: form.name.trim(),
            className: form.className.trim(),
            subject: form.subject.trim(),
            date: apiDate,
            period: form.period.trim(),
            examType: form.examType.trim(),
          },
          { idempotencyKey: newIdempotencyKey() },
        ).then(() => setForm(EMPTY_FORM)),
      "Créer cet examen ?",
    );
  };

  const stateMessage =
    status === "unauthenticated" || status === "forbidden" || status === "offline" || status === "error"
      ? errorMessage
      : null;
  const loading = status === "idle" || status === "loading";
  const mutationsBlocked = busy || status === "offline";

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
      data={status === "success" ? filtered : []}
      keyExtractor={(row) => row.id}
      ListHeaderComponent={
        <>
          <Text style={styles.title}>Examens</Text>
          <Text style={styles.subtitle}>Sessions d'évaluation de l'établissement</Text>
          {loading ? (
            <View style={styles.stateCard} accessibilityRole="progressbar">
              <ActivityIndicator color="#2563EB" />
              <Text style={styles.stateText}>Chargement des examens…</Text>
            </View>
          ) : null}
          {stateMessage ? (
            <View style={styles.errorCard} accessibilityRole="alert">
              <Text style={styles.errorText}>{stateMessage}</Text>
              <TouchableOpacity style={styles.retryButton} onPress={() => void refresh()}>
                <Text style={styles.retryText}>Réessayer</Text>
              </TouchableOpacity>
            </View>
          ) : null}
          {status === "empty" ? (
            <View style={styles.stateCard}>
              <Text style={styles.stateText}>Aucun examen pour cet établissement.</Text>
            </View>
          ) : null}
          {status === "success" ? (
            <>
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Rechercher un examen"
                style={styles.search}
              />
              <ChipRow label="Classe" value={classFilter} options={classOptions} onChange={setClassFilter} />
              <ChipRow label="Période" value={periodFilter} options={periodOptions} onChange={setPeriodFilter} />
              <ChipRow label="Statut" value={statusFilter} options={statusOptions} onChange={setStatusFilter} />
            </>
          ) : null}
          {canCreate ? (
            <View style={styles.form}>
              <Text style={styles.sectionTitle}>Nouvel examen</Text>
              {(
                [
                  ["name", "Intitulé"],
                  ["className", "Classe"],
                  ["subject", "Matière"],
                  ["date", "Date JJ-MM-AAAA"],
                  ["period", "Période"],
                  ["examType", "Type"],
                ] as const
              ).map(([key, label]) => (
                <TextInput
                  key={key}
                  value={form[key]}
                  onChangeText={(value) => setForm((current) => ({ ...current, [key]: value }))}
                  placeholder={label}
                  style={styles.search}
                />
              ))}
              <TouchableOpacity
                style={[styles.action, mutationsBlocked && styles.actionDisabled]}
                disabled={mutationsBlocked}
                onPress={submitCreate}
              >
                <Text style={styles.actionText}>Créer</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </>
      }
      renderItem={({ item }) => {
        const detail = details[item.id] ?? item;
        return (
          <ExpandableEntityCard
            title={item.name || "Examen"}
            subtitle={[item.className, item.subject].filter(Boolean).join(" · ") || "Classe non renseignée"}
            badge={item.status || "—"}
            expanded={expandedId === item.id}
            onExpandedChange={(expanded) => {
              setExpandedId((current) => nextExclusiveExpandedKey(current, item.id));
              void loadDetail(item.id, expanded);
            }}
          >
            <Text style={styles.detail}>Date : {formatDateForDisplay(detail.date) || "—"}</Text>
            <Text style={styles.detail}>Période : {detail.period || "—"}</Text>
            <Text style={styles.detail}>Type : {detail.examType || "—"}</Text>
            <Text style={styles.detail}>Statut : {detail.status || "—"}</Text>
            {canValidate ? (
              <TouchableOpacity
                style={[styles.action, mutationsBlocked && styles.actionDisabled]}
                disabled={mutationsBlocked}
                onPress={() =>
                  void runMutation(
                    () => validateExam(item.id, { idempotencyKey: newIdempotencyKey() }),
                    "Valider cet examen ?",
                  )
                }
              >
                <Text style={styles.actionText}>Valider</Text>
              </TouchableOpacity>
            ) : null}
            {canUpdate ? (
              <>
                <TouchableOpacity
                  style={[styles.actionSecondary, mutationsBlocked && styles.actionDisabled]}
                  disabled={mutationsBlocked}
                  onPress={() =>
                    void runMutation(
                      () =>
                        patchExam(
                          item.id,
                          {
                            name: detail.name,
                            className: detail.className,
                            subject: detail.subject,
                            examType: detail.examType,
                            date: detail.date,
                            period: detail.period,
                          },
                          { idempotencyKey: newIdempotencyKey() },
                        ),
                      "Enregistrer les informations de cet examen ?",
                    )
                  }
                >
                  <Text style={styles.actionSecondaryText}>Modifier</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionDanger, mutationsBlocked && styles.actionDisabled]}
                  disabled={mutationsBlocked}
                  onPress={() =>
                    void runMutation(
                      () => cancelExam(item.id, { idempotencyKey: newIdempotencyKey() }),
                      "Annuler cet examen ?",
                    )
                  }
                >
                  <Text style={styles.actionDangerText}>Annuler</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {canArchive ? (
              <TouchableOpacity
                style={[styles.actionDanger, mutationsBlocked && styles.actionDisabled]}
                disabled={mutationsBlocked}
                onPress={() =>
                  void runMutation(
                    () => archiveExam(item.id, { idempotencyKey: newIdempotencyKey() }),
                    "Archiver cet examen ?",
                  )
                }
              >
                <Text style={styles.actionDangerText}>Archiver</Text>
              </TouchableOpacity>
            ) : null}
          </ExpandableEntityCard>
        );
      }}
    />
  );
}

function ChipRow({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  if (!options.length) return null;
  return (
    <View style={styles.chips}>
      <TouchableOpacity style={[styles.chip, !value && styles.chipActive]} onPress={() => onChange("")}>
        <Text style={[styles.chipText, !value && styles.chipTextActive]}>{label} : tous</Text>
      </TouchableOpacity>
      {options.map((option) => (
        <TouchableOpacity
          key={option}
          style={[styles.chip, value === option && styles.chipActive]}
          onPress={() => onChange(value === option ? "" : option)}
        >
          <Text style={[styles.chipText, value === option && styles.chipTextActive]}>{option}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16, gap: 10 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontSize: 15, fontWeight: "600" },
  search: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 14,
    fontWeight: "700",
    color: "#0F172A",
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { borderRadius: 999, backgroundColor: "#E2E8F0", paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: "#2563EB" },
  chipText: { color: "#334155", fontWeight: "800", fontSize: 13 },
  chipTextActive: { color: "#FFFFFF" },
  form: { backgroundColor: "#FFFFFF", borderRadius: 20, padding: 14, gap: 8 },
  sectionTitle: { color: "#0F172A", fontSize: 18, fontWeight: "900" },
  stateCard: {
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
  },
  stateText: { color: "#64748B", fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorCard: { borderRadius: 20, backgroundColor: "#FEF2F2", padding: 20, gap: 14 },
  errorText: { color: "#991B1B", fontSize: 15, fontWeight: "800" },
  retryButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
  },
  retryText: { color: "#FFFFFF", fontWeight: "800" },
  detail: { color: "#334155", fontWeight: "700", marginBottom: 6 },
  action: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  actionText: { color: "#FFFFFF", fontWeight: "800" },
  actionSecondary: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  actionSecondaryText: { color: "#1D4ED8", fontWeight: "800" },
  actionDanger: {
    minHeight: 44,
    borderRadius: 12,
    backgroundColor: "#FEE2E2",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  actionDangerText: { color: "#991B1B", fontWeight: "800" },
  actionDisabled: { opacity: 0.45 },
});
