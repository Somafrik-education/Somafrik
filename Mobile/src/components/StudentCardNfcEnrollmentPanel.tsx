import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import { studentCardEnrollmentApi as api } from "../services/studentCardEnrollmentApi";
import { createIdempotencyKey } from "../lib/networkResilience";
import {
  acceptNfcCardListResult, applyNfcCardListResponse, beginNfcCardListLoad, clearNfcRefreshNotice, createIndividualNfcFlow,
  keepNfcTerminalNotice, NFC_INTERRUPTED_RESERVATION_LABEL, NFC_LIST_REFRESHING_COPY, NFC_LIST_STALE_COPY, NFC_PHASE_COPY, NFC_REPLACE_ACTIVE_LABEL,
  NFC_SERVER_RESUME_LABEL, nfcEnrollmentPrimaryAction, nfcFailure, nfcListSensitiveActionsAllowed, noteNfcRefreshFailure, nfcServerResumeVisible, setNfcTerminalNotice,
  type EnrollmentCard, type NfcDisplayedCardList, type NfcEncoderHardware, type NfcNoticeBoard, type NfcPhase,
} from "../lib/studentCardNfcEncoding";

type Props = { studentId: string; canRead: boolean; canUpdate: boolean; mutationsBlocked: boolean; scopeKey?: string };
const statusLabels: Record<string, string> = { active: "Active", issued: "Réservée — non active", lost: "Perdue", revoked: "Révoquée", replaced: "Remplacée" };
const stateLabels = { pending: "Écriture à confirmer", encoded: "Encodée", locked: "En lecture seule" };

export function StudentCardNfcEnrollmentPanel({ studentId, canRead, canUpdate, mutationsBlocked, scopeKey = "" }: Props) {
  const [cards, setCards] = useState<EnrollmentCard[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [listStale, setListStale] = useState(false);
  const listStaleRef = useRef(false);
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<NfcPhase>("initial");
  const [notices, setNotices] = useState<NfcNoticeBoard>({ terminal: "", refresh: "" });
  const [refresh, setRefresh] = useState(0);
  const listSnapshot = useRef<NfcDisplayedCardList | null>(null);
  const ownerRef = useRef({ scopeKey, studentId });
  ownerRef.current = { scopeKey, studentId };
  const hardware = useRef<NfcEncoderHardware | null>(null);
  const flow = useRef<ReturnType<typeof createIndividualNfcFlow> | null>(null);
  const generation = useRef(0);
  const busy = useRef(false);
  const foreground = useRef(AppState.currentState === "active");
  const live = useRef(true);
  const permitted = useRef(false);
  permitted.current = canRead && canUpdate && !mutationsBlocked;
  const operationValid = useRef<() => boolean>(() => false);
  const refreshAllowed = useRef(false);
  refreshAllowed.current = canRead;
  const closeHardware = () => { void hardware.current?.close().catch(() => { /* quarantined shared manager refuses further use */ }); };

  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (!foreground.current) { generation.current++; closeHardware(); }
      else setRefresh((value) => value + 1);
    });
    return () => { live.current = false; generation.current++; flow.current = null; closeHardware(); subscription.remove(); };
  }, []);
  useEffect(() => {
    generation.current++; flow.current = null; closeHardware(); hardware.current = null;
  }, [studentId, scopeKey]);
  useEffect(() => {
    if (!canRead || !canUpdate || mutationsBlocked) { generation.current++; closeHardware(); }
  }, [canRead, canUpdate, mutationsBlocked]);
  useEffect(() => {
    let current = true;
    const request = { scopeKey, studentId };
    const markStale = (stale: boolean) => { listStaleRef.current = stale; setListStale(stale); };
    if (!canRead || !studentId) {
      listSnapshot.current = null; markStale(false); setCards(null); setEnabled(false); setAvailable(false); setRefreshing(false);
      return () => { current = false; };
    }
    const started = beginNfcCardListLoad(listSnapshot.current, scopeKey, studentId);
    if (!started.retain) {
      listSnapshot.current = null; markStale(false); setCards(null); setEnabled(false); setAvailable(false);
    }
    setRefreshing(started.retain);
    const retained = started.retain ? listSnapshot.current : null;
    void (async () => {
      let listApplied = false;
      try {
        const response = await api.list(studentId);
        if (!current || !acceptNfcCardListResult(request, ownerRef.current)) return;
        const applied = applyNfcCardListResponse(retained, scopeKey, studentId, response);
        if (applied.malformed) { setNotices((board) => noteNfcRefreshFailure(board, nfcFailure("NFC_RESPONSE_INVALID"))); markStale(retained !== null); return; }
        listApplied = true;
        listSnapshot.current = applied.list; setCards(applied.list?.cards ?? []); markStale(false); setNotices(clearNfcRefreshNotice);
        const nfcEnabled = Boolean(response && typeof response === "object" && "nfcEnabled" in response && response.nfcEnabled === true);
        setEnabled(nfcEnabled);
        if (nfcEnabled && Platform.OS === "android") {
          // A separate facade owns only its probe lease, never the programming lease.
          const { createNfcEncoderHardware } = await import("../lib/studentCardNfcEncoderNative");
          if (!current || !acceptNfcCardListResult(request, ownerRef.current)) return;
          await createNfcEncoderHardware().availability();
          if (current && acceptNfcCardListResult(request, ownerRef.current)) setAvailable(true);
        } else if (current) setAvailable(false);
      } catch (error: unknown) {
        if (current) { setNotices((board) => noteNfcRefreshFailure(board, error)); if (!listApplied) markStale(retained !== null); }
      } finally {
        if (current) setRefreshing(false);
      }
    })();
    return () => { current = false; };
  }, [canRead, studentId, scopeKey, refresh]);

  async function getFlow() {
    if (!hardware.current) {
      const { createNfcEncoderHardware } = await import("../lib/studentCardNfcEncoderNative");
      if (!operationValid.current()) throw nfcFailure("NFC_CANCELLED");
      hardware.current = createNfcEncoderHardware((prompt) => { if (operationValid.current()) setNotices((board) => setNfcTerminalNotice(board, prompt)); });
    }
    if (!flow.current) flow.current = createIndividualNfcFlow({
      studentId, api, hardware: hardware.current, uuid: createIdempotencyKey,
      valid: () => operationValid.current(), phase: (next) => {
        if (operationValid.current()) { setPhase(next); setNotices((board) => setNfcTerminalNotice(board, NFC_PHASE_COPY[next])); }
      },
    });
    return flow.current;
  }
  async function run(action: (controller: Awaited<ReturnType<typeof getFlow>>) => Promise<unknown>) {
    if (listStaleRef.current) return;
    if (!live.current || busy.current || !foreground.current || !permitted.current || !enabled || !available || Platform.OS !== "android") return;
    busy.current = true; setWorking(true);
    const captured = ++generation.current;
    const valid = () => live.current && foreground.current && permitted.current && captured === generation.current;
    operationValid.current = valid;
    try { const controller = await getFlow(); if (!valid()) throw nfcFailure("NFC_CANCELLED"); await action(controller); }
    catch (error) {
      if (valid()) {
        const code = error && typeof error === "object" && "code" in error ? error.code : "";
        setPhase(code === "STUDENT_CARD_NFC_EXPIRED" ? "expired" : "error");
        setNotices((board) => keepNfcTerminalNotice(board, error));
      }
    } finally {
      busy.current = false;
      if (live.current) { setWorking(false); if (refreshAllowed.current) setRefresh((value) => value + 1); }
    }
  }
  function replace(card: EnrollmentCard) {
    Alert.alert("Confirmer le remplacement", "L’ancienne carte restera active jusqu’à l’écriture, la relecture et la confirmation serveur de la nouvelle carte.", [
      { text: "Conserver", style: "cancel" },
      { text: "Programmer la nouvelle carte", onPress: () => void run((controller) => controller.program(card)) },
    ]);
  }
  function rewrite(card: EnrollmentCard) {
    Alert.alert("Confirmer la réécriture", "Relisez et confirmez d’abord la carte si elle a déjà été écrite. Cette action renouvelle le secret de la réservation existante sans prolonger son expiration. Le contenu de cette même carte pourra être réécrit.", [
      { text: "Annuler", style: "cancel" },
      { text: "Renouveler et écrire", onPress: () => void run((controller) => controller.rewrite(card, true)) },
    ]);
  }
  if (!canRead) return null;
  const active = cards?.find((card) => card.status === "active");
  const pending = cards?.some((card) => card.status === "issued" && card.nfc?.state === "pending");
  const primary = nfcEnrollmentPrimaryAction({ uncertain: Boolean(flow.current?.hasUncertainReservation()), hasPending: Boolean(pending), hasActive: Boolean(active) });
  const canProgram = permitted.current && enabled && available && nfcListSensitiveActionsAllowed({ stale: listStale, hasList: cards !== null });
  const button = (title: string, onPress: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} disabled={working || !canProgram} onPress={onPress} style={{ padding: 12, marginVertical: 4, backgroundColor: "#E8F4F1", borderRadius: 8, opacity: working || !canProgram ? 0.5 : 1 }}><Text>{title}</Text></TouchableOpacity>;
  return <View testID="student-card-nfc-enrollment-panel">
    <Text>Cartes NFC NTAG213 / NTAG216</Text>
    <Text accessibilityLiveRegion="polite">{notices.terminal || NFC_PHASE_COPY[phase]}</Text>
    {notices.refresh ? <Text>{notices.refresh}</Text> : null}
    {working ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Annuler l’opération NFC" onPress={() => {
      generation.current++; closeHardware(); setPhase("resume"); setNotices((board) => setNfcTerminalNotice(board, "Opération interrompue. Aucune activation locale n’est confirmée. Reprenez l’opération existante."));
    }} style={{ padding: 12 }}><Text>Annuler l’opération NFC</Text></TouchableOpacity> : null}
    {!cards ? <Text>Chargement ou service indisponible.</Text> : null}
    {refreshing && cards ? <Text>{NFC_LIST_REFRESHING_COPY}</Text> : null}
    {listStale && cards ? <Text>{NFC_LIST_STALE_COPY}</Text> : null}
    {cards?.map((card) => <View key={card.id} style={{ paddingVertical: 10 }}>
      <Text>Carte {card.publicId} — {statusLabels[card.status] || "État inconnu"}</Text>
      {card.nfc ? <Text>{card.nfc.tagType} · {stateLabels[card.nfc.state]}</Text> : null}
      {card.status === "issued" && card.nfc ? <>
        <Text>Réservation non active. Expiration : {card.nfc.expiresAt ? new Date(card.nfc.expiresAt).toLocaleString() : "indisponible"}.</Text>
        {card.nfc.replacesCardId ? <Text>Remplacement préparé : l’ancienne carte reste utilisable jusqu’à confirmation.</Text> : null}
        {canProgram && nfcServerResumeVisible(card) ? <>
          {button(NFC_SERVER_RESUME_LABEL, () => void run((controller) => controller.resume(card)))}
          {button("Renouveler et réécrire avec confirmation", () => rewrite(card))}
        </> : null}
      </> : null}
      {canProgram && card.status === "active" && card.nfc ? button("Relire et vérifier la carte active", () => void run(async (controller) => { await controller.resume(card); if (operationValid.current()) setNotices((board) => setNfcTerminalNotice(board, "Carte active relue et vérifiée.")); })) : null}
    </View>)}
    {Platform.OS !== "android" ? <Text>La programmation NFC est disponible sur Android uniquement.</Text> : null}
    {cards && !enabled ? <Text>La programmation NFC est désactivée pour cet établissement.</Text> : null}
    {enabled && Platform.OS === "android" && !available ? <Text>NFC indisponible ou désactivé. Activez-le puis actualisez.</Text> : null}
    {mutationsBlocked ? <Text>Une connexion et des droits à jour sont nécessaires.</Text> : null}
    {canRead && !working ? <TouchableOpacity accessibilityRole="button" onPress={() => setRefresh((value) => value + 1)} style={{ padding: 12 }}><Text>Actualiser l’état des cartes et du NFC</Text></TouchableOpacity> : null}
    {canProgram && primary === "interrupted" ? button(NFC_INTERRUPTED_RESERVATION_LABEL, () => void run((controller) => controller.resume())) : null}
    {canProgram && primary === "replace" && active ? button(NFC_REPLACE_ACTIVE_LABEL, () => replace(active)) : null}
    {canProgram && primary === "program" ? button(NFC_PHASE_COPY.initial, () => void run((controller) => controller.program())) : null}
  </View>;
}
