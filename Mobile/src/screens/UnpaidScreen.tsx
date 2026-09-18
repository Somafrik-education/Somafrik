import { useCallback, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import CanonicalMutationModal from "../components/CanonicalMutationModal";
import ChoiceChips from "../components/ChoiceChips";
import ExpandableFinanceCard from "../components/ExpandableFinanceCard";
import FormField from "../components/FormField";
import PaymentMutationControls from "../components/PaymentMutationControls";
import { useAuth } from "../context/AuthContext";
import { useAdminData } from "../context/AdminDataContext";
import { hasSecurityPermission } from "../domain/security/permissions";
import { useUnpaidLedger } from "../hooks/useUnpaidLedger";
import { isOfflineContext } from "../lib/connectivity";
import { formatFinanceAmount, formatFinanceDate, resolveFinanceCurrency } from "../lib/financeCurrency";
import { canRecordSchoolPayment } from "../lib/mobileCrudParity";
import { MIN_TOUCH_TARGET_DP } from "../lib/mobileUsability";
import { createIntentionStore } from "../lib/mutationGuard";
import { paymentStudentsFromOptions } from "../lib/paymentEnrollment";
import { useFloatingTabBarLayout } from "../lib/screenLayout";
import {
  classOptionsFromUnpaid,
  filterUnpaidRows,
  periodOptionsFromFees,
  unpaidTotalsByCurrency,
} from "../lib/unpaidFilters";
import { unpaidLedgerStateMessage } from "../lib/unpaidLedger";
import {
  buildReminderMessage,
  canForceUnpaidReminder,
  canSendReminder,
  canSendUnpaidReminder,
} from "../lib/unpaidReminders";
import {
  createUnpaidReminder,
  getFinanceCatalog,
  getPaymentStudentOptions,
} from "../services/api";
import { ApiClientError } from "../services/httpClient";

const REMINDER_CHANNELS = [
  { id: "notification", label: "Notification" },
  { id: "email", label: "Email" },
  { id: "sms", label: "SMS" },
  { id: "whatsapp", label: "WhatsApp" },
];

const REMINDER_RECIPIENTS = [
  { id: "Parent", label: "Parent" },
  { id: "Responsable", label: "Responsable" },
  { id: "Étudiant", label: "Étudiant" },
];

export default function UnpaidScreen() {
  const { session } = useAuth();
  const { activeSchoolCode, studentFeesData, loadPayments, loadStudentFees } = useAdminData();
  const { scrollContentPaddingBottom } = useFloatingTabBarLayout();
  const canReadUnpaid = hasSecurityPermission(session, "Impayés", "READ");
  const canRemind = canSendUnpaidReminder(session);
  const canForce = canForceUnpaidReminder(session);
  const canPay = canRecordSchoolPayment(session);
  const requestedSchoolCode = activeSchoolCode || session?.school?.code || session?.user?.schoolCode;
  const [searchQuery, setSearchQuery] = useState("");
  const [classFilter, setClassFilter] = useState("");
  const [periodFilter, setPeriodFilter] = useState("");
  const { state, refresh } = useUnpaidLedger(canReadUnpaid, requestedSchoolCode, {
    period: periodFilter || undefined,
  });
  const stateMessage = unpaidLedgerStateMessage(state);
  const loading = state.status === "idle" || state.status === "loading";

  const [paymentStudents, setPaymentStudents] = useState<ReturnType<typeof paymentStudentsFromOptions>>([]);
  const [paymentMethods, setPaymentMethods] = useState<string[]>([]);
  const [catalogCurrency, setCatalogCurrency] = useState("");
  const [paymentStudentId, setPaymentStudentId] = useState("");
  const [openSignal, setOpenSignal] = useState(0);

  const [reminderStudentId, setReminderStudentId] = useState<string | null>(null);
  const [reminderChannel, setReminderChannel] = useState("notification");
  const [reminderRecipient, setReminderRecipient] = useState("Parent");
  const [reminderMessage, setReminderMessage] = useState("");
  const [reminderError, setReminderError] = useState("");
  const [reminderSaving, setReminderSaving] = useState(false);
  const reminderIntentions = useRef(createIntentionStore());

  const refreshFinance = useCallback(async () => {
    await Promise.all([
      refresh(),
      loadPayments(),
      loadStudentFees(),
      getPaymentStudentOptions()
        .then((rows) => setPaymentStudents(paymentStudentsFromOptions(rows)))
        .catch(() => setPaymentStudents([])),
      getFinanceCatalog()
        .then((catalog) => {
          setPaymentMethods((catalog.paymentMethods ?? []).filter((row) => row.active).map((row) => row.label));
          setCatalogCurrency(resolveFinanceCurrency(catalog.currency));
        })
        .catch(() => setPaymentMethods([])),
    ]);
  }, [refresh, loadPayments, loadStudentFees]);

  useFocusEffect(
    useCallback(() => {
      void refreshFinance();
    }, [refreshFinance]),
  );

  const filteredRows = useMemo(
    () =>
      filterUnpaidRows(state.status === "success" ? state.rows : [], {
        search: searchQuery || undefined,
        className: classFilter || undefined,
      }),
    [state, searchQuery, classFilter],
  );
  const filteredTotals = useMemo(() => unpaidTotalsByCurrency(filteredRows), [filteredRows]);
  const classOptions = useMemo(
    () => classOptionsFromUnpaid(state.status === "success" ? state.catalogRows : []),
    [state],
  );
  const periodOptions = useMemo(
    () => periodOptionsFromFees(state.status === "success" ? state.fees : []),
    [state],
  );
  const filtersActive = Boolean(searchQuery || classFilter || periodFilter);
  const reminderRow = filteredRows.find((row) => row.studentId === reminderStudentId) ?? null;

  const openReminder = (studentId: string) => {
    const row = filteredRows.find((item) => item.studentId === studentId);
    if (!row || !canRemind) return;
    reminderIntentions.current.rotate(`unpaid-reminder-${studentId}`);
    setReminderStudentId(studentId);
    setReminderChannel("notification");
    setReminderRecipient("Parent");
    setReminderMessage(buildReminderMessage(row, session?.school?.name));
    setReminderError("");
  };

  const submitReminder = async (force = false) => {
    if (!reminderRow || reminderSaving) return;
    if (!canRemind) {
      setReminderError("Vous n'êtes pas autorisé à envoyer des relances.");
      return;
    }
    if (isOfflineContext()) {
      setReminderError("Connexion requise pour envoyer une relance.");
      return;
    }
    const gate = canSendReminder(
      reminderRow.lastReminderAt
        ? [{ studentId: reminderRow.studentId, sendStatus: "Envoyée", sentAt: reminderRow.lastReminderAt }]
        : [],
      reminderRow.studentId,
    );
    if (!gate.allowed && !force) {
      if (!canForce) {
        setReminderError(gate.message ?? "Une relance a déjà été envoyée récemment.");
        return;
      }
      Alert.alert("Relance récente", gate.message ?? "Une relance a déjà été envoyée récemment.", [
        { text: "Annuler", style: "cancel" },
        { text: "Envoyer quand même", onPress: () => void submitReminder(true) },
      ]);
      return;
    }
    setReminderSaving(true);
    setReminderError("");
    const idempotencyKey = reminderIntentions.current.getOrCreate(`unpaid-reminder-${reminderRow.studentId}`);
    try {
      await createUnpaidReminder(
        reminderRow.studentId,
        {
          channel: reminderChannel,
          recipient: reminderRecipient,
          message: reminderMessage.trim(),
          force,
        },
        { idempotencyKey },
      );
      reminderIntentions.current.rotate(`unpaid-reminder-${reminderRow.studentId}`);
      setReminderStudentId(null);
      await refreshFinance();
    } catch (error) {
      const code = error instanceof ApiClientError ? error.code : undefined;
      const status = error instanceof ApiClientError ? error.status : undefined;
      if (code === "REMINDER_COOLDOWN" && canForce && !force) {
        Alert.alert(
          "Relance récente",
          error instanceof Error ? error.message : "Relance récente, cooldown actif",
          [
            { text: "Annuler", style: "cancel" },
            { text: "Envoyer quand même", onPress: () => void submitReminder(true) },
          ],
        );
      } else {
        const prefix =
          status === 401
            ? "Session expirée. "
            : status === 403
              ? "Accès refusé. "
              : status === 409
                ? ""
                : status && status >= 500
                  ? "Erreur serveur. "
                  : "";
        setReminderError(
          `${prefix}${error instanceof Error ? error.message : "Échec de l'enregistrement de la relance"}`,
        );
      }
    } finally {
      setReminderSaving(false);
    }
  };

  const openPayment = (studentId: string) => {
    if (!canPay) return;
    setPaymentStudentId(studentId);
    setOpenSignal((current) => current + 1);
  };

  return (
    <>
      <FlatList
        style={styles.container}
        contentContainerStyle={[styles.content, { paddingBottom: scrollContentPaddingBottom }]}
        data={state.status === "success" ? filteredRows : []}
        keyExtractor={(row) => row.studentId}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Impayés</Text>
            <Text style={styles.subtitle}>Créances ouvertes de l’établissement</Text>

            {loading ? (
              <View style={styles.stateCard} accessibilityRole="progressbar" accessibilityLabel="Chargement des impayés">
                <ActivityIndicator color="#2563EB" />
                <Text style={styles.stateText}>Chargement des impayés…</Text>
              </View>
            ) : null}

            {stateMessage ? (
              <View style={styles.errorCard} accessibilityRole="alert">
                <Text style={styles.errorText}>{stateMessage}</Text>
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Réessayer de charger les impayés"
                  style={styles.retryButton}
                  onPress={() => void refreshFinance()}
                >
                  <Text style={styles.retryText}>Réessayer</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {state.status === "empty" ? (
              <View style={styles.stateCard}>
                <Text style={styles.stateText}>Aucun impayé pour cet établissement.</Text>
              </View>
            ) : null}

            {state.status === "success" ? (
              <>
                <FormField
                  label="Recherche"
                  type="search"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Nom, matricule ou classe"
                  testID="unpaid-search"
                />
                <ChoiceChips
                  label="Classe"
                  options={[{ id: "", label: "Toutes" }, ...classOptions.map((item) => ({ id: item, label: item }))]}
                  selectedId={classFilter}
                  onSelect={setClassFilter}
                />
                <ChoiceChips
                  label="Période"
                  options={[{ id: "", label: "Toutes" }, ...periodOptions.map((item) => ({ id: item, label: item }))]}
                  selectedId={periodFilter}
                  onSelect={setPeriodFilter}
                />
                {filtersActive ? (
                  <TouchableOpacity
                    style={styles.resetFilters}
                    onPress={() => {
                      setSearchQuery("");
                      setClassFilter("");
                      setPeriodFilter("");
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Réinitialiser les filtres"
                  >
                    <Text style={styles.resetFiltersText}>Réinitialiser les filtres</Text>
                  </TouchableOpacity>
                ) : null}

                <View
                  style={styles.summaryCard}
                  accessibilityLabel={`${filteredRows.length} élève(s) en impayé`}
                >
                  <View style={styles.summaryStudents}>
                    <Text style={styles.summaryValue}>{filteredRows.length}</Text>
                    <Text style={styles.summaryLabel}>Élève(s)</Text>
                  </View>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryAmountBox}>
                    {filteredTotals.totalsByCurrency.map((total) => (
                      <Text
                        key={total.currency || "unknown"}
                        style={styles.summaryAmount}
                        numberOfLines={1}
                        adjustsFontSizeToFit
                      >
                        {total.currency && total.currency !== "Devise non renseignée"
                          ? formatFinanceAmount(total.amount, total.currency)
                          : `${new Intl.NumberFormat("fr-FR").format(total.amount)} · devise non renseignée`}
                      </Text>
                    ))}
                    <Text style={styles.summaryLabel}>Reste dû</Text>
                  </View>
                </View>
                <Text style={styles.sectionTitle}>Élèves concernés</Text>
                {filteredRows.length === 0 ? (
                  <View style={styles.stateCard}>
                    <Text style={styles.stateText}>Aucun impayé pour ces filtres.</Text>
                  </View>
                ) : null}
              </>
            ) : null}
          </>
        }
        renderItem={({ item }) => (
          <ExpandableFinanceCard
            title={item.studentName}
            subtitle={item.className || "Classe non renseignée"}
            badge={formatFinanceAmount(item.amountDue, item.currency)}
            badgeTone="danger"
            testID={`unpaid-student-${item.studentId}`}
            summaryActions={
              canRemind || canPay ? (
                <View style={styles.actionsRow}>
                  {canRemind ? (
                    <TouchableOpacity
                      style={styles.actionButton}
                      onPress={() => openReminder(item.studentId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Relancer ${item.studentName}`}
                      testID={`unpaid-remind-${item.studentId}`}
                    >
                      <Text style={styles.actionText}>Relancer</Text>
                    </TouchableOpacity>
                  ) : null}
                  {canPay ? (
                    <TouchableOpacity
                      style={[styles.actionButton, styles.actionPrimary]}
                      onPress={() => openPayment(item.studentId)}
                      accessibilityRole="button"
                      accessibilityLabel={`Encaisser ${item.studentName}`}
                      testID={`unpaid-collect-${item.studentId}`}
                    >
                      <Text style={styles.actionPrimaryText}>Encaisser</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null
            }
          >
            <View style={styles.detailGrid}>
              <Text style={styles.detailLabel}>Période</Text>
              <Text style={styles.detailValue}>{item.periodLabel || "Non renseignée"}</Text>
              <Text style={styles.detailLabel}>Retard</Text>
              <Text style={styles.detailValue}>{item.daysLate > 0 ? `${item.daysLate} jour(s)` : "Non échu"}</Text>
              <Text style={styles.detailLabel}>Montant attendu</Text>
              <Text style={styles.detailValue}>{formatFinanceAmount(item.amountExpected, item.currency)}</Text>
              <Text style={styles.detailLabel}>Montant alloué aux impayés ouverts</Text>
              <Text style={styles.detailValue}>{formatFinanceAmount(item.amountPaid, item.currency)}</Text>
              <Text style={styles.detailLabel}>Reste dû</Text>
              <Text style={styles.detailValue}>{formatFinanceAmount(item.amountDue, item.currency)}</Text>
              <Text style={styles.detailLabel}>Échéance</Text>
              <Text style={styles.detailValue}>{formatFinanceDate(item.dueDate)}</Text>
            </View>
          </ExpandableFinanceCard>
        )}
        ListFooterComponent={
          canPay ? (
            <PaymentMutationControls
              students={paymentStudents}
              studentFees={studentFeesData}
              paymentMethods={paymentMethods}
              currency={catalogCurrency}
              initialStudentId={paymentStudentId}
              openSignal={openSignal}
              hideTrigger
              onChanged={() => refreshFinance()}
            />
          ) : null
        }
      />
      <CanonicalMutationModal
        visible={Boolean(reminderRow)}
        title="Relancer"
        error={reminderError}
        saving={reminderSaving}
        submitLabel={reminderSaving ? "Envoi…" : "Envoyer la relance"}
        onClose={() => setReminderStudentId(null)}
        onSubmit={() => void submitReminder(false)}
        submitDisabled={!reminderRow}
      >
        <ChoiceChips
          label="Canal"
          options={REMINDER_CHANNELS}
          selectedId={reminderChannel}
          onSelect={setReminderChannel}
          disabled={reminderSaving}
        />
        <ChoiceChips
          label="Destinataire"
          options={REMINDER_RECIPIENTS}
          selectedId={reminderRecipient}
          onSelect={setReminderRecipient}
          disabled={reminderSaving}
        />
        <FormField
          label="Message"
          value={reminderMessage}
          onChangeText={setReminderMessage}
          multiline
          editable={!reminderSaving}
        />
      </CanonicalMutationModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F4F7FB" },
  content: { padding: 16 },
  title: { fontSize: 28, fontWeight: "900", color: "#0F172A" },
  subtitle: { color: "#64748B", fontSize: 15, fontWeight: "600", marginTop: 4, marginBottom: 18 },
  stateCard: {
    minHeight: 88,
    borderRadius: 20,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    padding: 20,
    marginBottom: 16,
  },
  stateText: { color: "#64748B", fontSize: 15, fontWeight: "700", textAlign: "center" },
  errorCard: { borderRadius: 20, backgroundColor: "#FEF2F2", padding: 20, gap: 14, marginBottom: 16 },
  errorText: { color: "#991B1B", fontSize: 15, fontWeight: "800", lineHeight: 21 },
  retryButton: {
    minHeight: 48,
    borderRadius: 14,
    backgroundColor: "#2563EB",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
  },
  retryText: { color: "#FFFFFF", fontWeight: "800", fontSize: 15 },
  resetFilters: {
    minHeight: MIN_TOUCH_TARGET_DP,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  resetFiltersText: { color: "#2563EB", fontWeight: "800" },
  summaryCard: {
    minHeight: 112,
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  summaryStudents: { minWidth: 72 },
  summaryValue: { color: "#0F172A", fontSize: 24, fontWeight: "900" },
  summaryAmount: { color: "#0F172A", fontSize: 18, fontWeight: "900", marginBottom: 3 },
  summaryLabel: { color: "#64748B", fontSize: 13, fontWeight: "700", marginTop: 5 },
  summaryDivider: { width: 1, alignSelf: "stretch", backgroundColor: "#E2E8F0", marginHorizontal: 16 },
  summaryAmountBox: { flex: 1 },
  sectionTitle: { color: "#0F172A", fontSize: 20, fontWeight: "900", marginBottom: 2 },
  detailGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 8 },
  detailLabel: { width: "43%", color: "#64748B", fontSize: 13, fontWeight: "600" },
  detailValue: { width: "57%", color: "#0F172A", fontSize: 13, fontWeight: "800", textAlign: "right" },
  actionsRow: { flexDirection: "row", gap: 8 },
  actionButton: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET_DP,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CBD5E1",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { color: "#0F172A", fontWeight: "800" },
  actionPrimary: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  actionPrimaryText: { color: "#FFFFFF", fontWeight: "800" },
});
