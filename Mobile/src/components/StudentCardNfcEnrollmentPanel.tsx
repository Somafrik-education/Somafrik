import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import { studentCardEnrollmentApi as api } from "../services/studentCardEnrollmentApi";
import { createIdempotencyKey } from "../lib/networkResilience";
import {
  createIndividualNfcFlow, isNfcConfirmFailure, NFC_PHASE_COPY, nfcConfirmFailureCopy, nfcErrorCopy, nfcFailure,
  type EnrollmentCard, type NfcEncoderHardware, type NfcPhase,
} from "../lib/studentCardNfcEncoding";

type Props = { studentId: string; canRead: boolean; canUpdate: boolean; mutationsBlocked: boolean };
const statusLabels: Record<string, string> = { active: "Active", issued: "Réservée — non active", lost: "Perdue", revoked: "Révoquée", replaced: "Remplacée" };
const stateLabels = { pending: "Écriture à confirmer", encoded: "Encodée", locked: "En lecture seule" };

export function StudentCardNfcEnrollmentPanel({ studentId, canRead, canUpdate, mutationsBlocked }: Props) {
  const [cards, setCards] = useState<EnrollmentCard[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [available, setAvailable] = useState(false);
  const [working, setWorking] = useState(false);
  const [phase, setPhase] = useState<NfcPhase>("initial");
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
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
    if (!canRead || !canUpdate || mutationsBlocked) { generation.current++; closeHardware(); }
  }, [canRead, canUpdate, mutationsBlocked]);
  useEffect(() => {
    let current = true;
    setCards(null); setEnabled(false); setAvailable(false);
    if (canRead && studentId) void (async () => {
      const response = await api.list(studentId);
      if (!current) return;
      if (!Array.isArray(response.cards)) throw nfcFailure("NFC_RESPONSE_INVALID");
      setCards(response.cards); setEnabled(response.nfcEnabled === true);
      if (response.nfcEnabled === true && Platform.OS === "android") {
        // A separate facade owns only its probe lease, never the programming lease.
        const { createNfcEncoderHardware } = await import("../lib/studentCardNfcEncoderNative");
        if (!current) return;
        await createNfcEncoderHardware().availability();
        if (current) setAvailable(true);
      }
    })().catch((error: unknown) => { if (current) setMessage(nfcErrorCopy(error)); });
    return () => { current = false; };
  }, [canRead, studentId, refresh]);

  async function getFlow() {
    if (!hardware.current) {
      const { createNfcEncoderHardware } = await import("../lib/studentCardNfcEncoderNative");
      if (!operationValid.current()) throw nfcFailure("NFC_CANCELLED");
      hardware.current = createNfcEncoderHardware((prompt) => { if (operationValid.current()) setMessage(prompt); });
    }
    if (!flow.current) flow.current = createIndividualNfcFlow({
      studentId, api, hardware: hardware.current, uuid: createIdempotencyKey,
      valid: () => operationValid.current(), phase: (next) => {
        if (operationValid.current()) { setPhase(next); setMessage(NFC_PHASE_COPY[next]); }
      },
    });
    return flow.current;
  }
  async function run(action: (controller: Awaited<ReturnType<typeof getFlow>>) => Promise<unknown>) {
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
        setMessage(isNfcConfirmFailure(error) ? nfcConfirmFailureCopy(error) : nfcErrorCopy(error));
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
  const canProgram = permitted.current && enabled && available && !!cards;
  const button = (title: string, onPress: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} disabled={working || !canProgram} onPress={onPress} style={{ padding: 12, marginVertical: 4, backgroundColor: "#E8F4F1", borderRadius: 8, opacity: working || !canProgram ? 0.5 : 1 }}><Text>{title}</Text></TouchableOpacity>;
  return <View testID="student-card-nfc-enrollment-panel">
    <Text>Cartes NFC NTAG213 / NTAG216</Text>
    <Text accessibilityLiveRegion="polite">{message || NFC_PHASE_COPY[phase]}</Text>
    {working ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Annuler l’opération NFC" onPress={() => {
      generation.current++; closeHardware(); setPhase("resume"); setMessage("Opération interrompue. Aucune activation locale n’est confirmée. Reprenez l’opération existante.");
    }} style={{ padding: 12 }}><Text>Annuler l’opération NFC</Text></TouchableOpacity> : null}
    {!cards ? <Text>Chargement ou service indisponible.</Text> : null}
    {cards?.map((card) => <View key={card.id} style={{ paddingVertical: 10 }}>
      <Text>Carte {card.publicId} — {statusLabels[card.status] || "État inconnu"}</Text>
      {card.nfc ? <Text>{card.nfc.tagType} · {stateLabels[card.nfc.state]}</Text> : null}
      {card.status === "issued" && card.nfc ? <>
        <Text>Réservation non active. Expiration : {card.nfc.expiresAt ? new Date(card.nfc.expiresAt).toLocaleString() : "indisponible"}.</Text>
        {card.nfc.replacesCardId ? <Text>Remplacement préparé : l’ancienne carte reste utilisable jusqu’à confirmation.</Text> : null}
        {canProgram ? <>
          {button("Reprendre l’opération — relire et confirmer", () => void run((controller) => controller.resume(card)))}
          {button("Renouveler et réécrire avec confirmation", () => rewrite(card))}
        </> : null}
      </> : null}
      {canProgram && card.status === "active" && card.nfc ? button("Relire et vérifier la carte active", () => void run(async (controller) => { await controller.resume(card); if (operationValid.current()) setMessage("Carte active relue et vérifiée."); })) : null}
    </View>)}
    {Platform.OS !== "android" ? <Text>La programmation NFC est disponible sur Android uniquement.</Text> : null}
    {cards && !enabled ? <Text>La programmation NFC est désactivée pour cet établissement.</Text> : null}
    {enabled && Platform.OS === "android" && !available ? <Text>NFC indisponible ou désactivé. Activez-le puis actualisez.</Text> : null}
    {mutationsBlocked ? <Text>Une connexion et des droits à jour sont nécessaires.</Text> : null}
    {canRead && !working ? <TouchableOpacity accessibilityRole="button" onPress={() => setRefresh((value) => value + 1)} style={{ padding: 12 }}><Text>Actualiser l’état des cartes et du NFC</Text></TouchableOpacity> : null}
    {canProgram && !pending ? <>
      {flow.current?.hasUncertainReservation() ? button("Reprendre la réservation interrompue", () => void run((controller) => controller.resume()))
        : active ? button("Remplacer la carte active", () => replace(active))
        : button("Programmer une carte NFC", () => void run((controller) => controller.program()))}
    </> : null}
  </View>;
}
