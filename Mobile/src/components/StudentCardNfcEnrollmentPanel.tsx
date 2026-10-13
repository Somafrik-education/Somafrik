import { useEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, Text, TouchableOpacity, View } from "react-native";
import { studentCardEnrollmentApi as api } from "../services/studentCardEnrollmentApi";
import {
  encodeNfcCard, verifyOrLockNfcCard, retryAndEncodeNfcCard, NFC_LOCK_WARNING,
  type EnrollmentCard, type IssuedNfcCard, type NfcEncoderHardware, type NtagIdentity,
} from "../lib/studentCardNfcEncoding";

type Props = { studentId: string; canRead: boolean; canUpdate: boolean; mutationsBlocked: boolean };
const cardStatusLabels: Record<string, string> = { active: "Active", issued: "Émise", lost: "Perdue", revoked: "Révoquée", replaced: "Remplacée" };
const labels = { pending: "Encodage à confirmer", encoded: "Encodée", locked: "Verrouillée définitivement" };
const errorCopy = (error: unknown) => error instanceof Error ? error.message : "Opération NFC interrompue. Relisez la carte et réessayez.";

export function StudentCardNfcEnrollmentPanel({ studentId, canRead, canUpdate, mutationsBlocked }: Props) {
  const [cards, setCards] = useState<EnrollmentCard[] | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [identity, setIdentity] = useState<NtagIdentity | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [refresh, setRefresh] = useState(0);
  const hardware = useRef<NfcEncoderHardware | null>(null);
  const issued = useRef<IssuedNfcCard | null>(null); // volatile only, never render the capability
  const operation = useRef(0);
  const busy = useRef(false);
  const live = useRef(true);
  const allowed = useRef(false);
  allowed.current = canUpdate && !mutationsBlocked;

  useEffect(() => {
    live.current = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") setRefresh((value) => value + 1);
      if (state !== "active") {
        operation.current++;
        issued.current = null;
        setIdentity(null);
        void hardware.current?.close();
      }
    });
    return () => { live.current = false; operation.current++; issued.current = null; void hardware.current?.close(); subscription.remove(); };
  }, []);
  useEffect(() => {
    if (!canUpdate || mutationsBlocked) {
      operation.current++; issued.current = null; setIdentity(null);
      void hardware.current?.close();
    }
  }, [canUpdate, mutationsBlocked]);
  useEffect(() => {
    let active = true;
    setCards(null); setEnabled(false);
    if (canRead && studentId) void api.list(studentId).then((response) => {
      if (!Array.isArray(response.cards)) throw new Error("Liste des cartes indisponible.");
      if (active) { setCards(response.cards); setEnabled(response.nfcEnabled === true); }
    }).catch((error: unknown) => { if (active) setMessage(errorCopy(error)); });
    return () => { active = false; };
  }, [canRead, studentId, refresh]);

  async function getHardware() {
    if (!hardware.current) {
      const { createNfcEncoderHardware } = await import("../lib/studentCardNfcEncoderNative");
      hardware.current = createNfcEncoderHardware((prompt) => { if (live.current && busy.current) setMessage(prompt); });
    }
    return hardware.current;
  }
  async function run(action: (device: NfcEncoderHardware, valid: () => boolean) => Promise<void>) {
    if (!live.current || busy.current || !allowed.current || !enabled || Platform.OS !== "android") return;
    busy.current = true; setWorking(true); setMessage("Présentez la carte au dos du téléphone. Retirez-la puis présentez-la à nouveau si demandé.");
    const generation = ++operation.current;
    const valid = () => live.current && allowed.current && generation === operation.current;
    const guardedApi = {
      ...api,
      async retry(card: EnrollmentCard, identity: NtagIdentity) {
        if (!valid()) throw new Error("Opération annulée.");
        return api.retry(card, identity);
      },
      async confirm(card: EnrollmentCard, token: string, locked: boolean) {
        if (!valid()) throw new Error("Opération annulée.");
        return api.confirm(card, token, locked);
      },
    };
    // Every hardware write is also guarded after asynchronous permission/session changes.
    try {
      const device = await getHardware();
      const guardedDevice: NfcEncoderHardware = {
        ...device,
        async inspect() { if (!valid()) throw new Error("Opération annulée."); return device.inspect(); },
        async openNdef(uid) { if (!valid()) throw new Error("Opération annulée."); await device.openNdef(uid); },
        async writeText(value) { if (!valid()) throw new Error("Opération annulée."); await device.writeText(value); },
        async makeReadOnly() { if (!valid()) throw new Error("Opération annulée."); await device.makeReadOnly(); },
      };
      // The single active operation uses the guarded API facade.
      confirmApi.current = guardedApi;
      await action(guardedDevice, valid);
      if (valid()) setRefresh((value) => value + 1);
    } catch (error) { if (valid()) { setMessage(errorCopy(error)); setRefresh((value) => value + 1); } }
    finally { busy.current = false; if (live.current) { setWorking(false); setRefresh((value) => value + 1); } }
  }
  const confirmApi = useRef<typeof api>(api);
  async function inspect() {
    await run(async (device, valid) => {
      const observed = await device.inspect();
      if (valid()) { setIdentity(observed); setMessage("UID lu. Vérifiez l’élève puis choisissez Encoder et affecter."); }
    });
  }
  async function encode() {
    if (!identity) return;
    await run(async (device, valid) => {
      let card = issued.current;
      if (!card) {
        // Same-card inspection immediately before reserving the UID on the server.
        const observed = await device.inspect();
        if (!valid() || observed.uid !== identity.uid || observed.tagType !== identity.tagType) throw new Error("Présentez la même carte NFC.");
        card = await api.issue(studentId, identity);
        if (!valid()) return;
        issued.current = card;
      }
      await encodeNfcCard(device, confirmApi.current, card);
      if (valid()) { issued.current = null; setIdentity(null); setMessage("Carte encodée, relue et affectée à cet élève. Vous pouvez maintenant la verrouiller."); }
    });
  }
  async function retry(card: EnrollmentCard) {
    await run(async (device, valid) => {
      await retryAndEncodeNfcCard(device, confirmApi.current, card, (reissued) => {
        if (valid()) { issued.current = reissued; setIdentity(card.nfc); }
      });
      if (valid()) { issued.current = null; setIdentity(null); setMessage("Encodage repris et confirmé. L’ancien identifiant est invalidé."); }
    });
  }
  function verify(card: EnrollmentCard, lock: boolean) {
    const execute = () => void run(async (device, valid) => {
      await verifyOrLockNfcCard(device, confirmApi.current, card, lock);
      if (valid()) { issued.current = null; setMessage(lock ? "Carte relue et verrouillée définitivement." : "Encodage vérifié et confirmé."); }
    });
    if (lock) Alert.alert("Verrouiller cette carte ?", NFC_LOCK_WARNING, [
      { text: "Annuler", style: "cancel" }, { text: "Verrouiller définitivement", style: "destructive", onPress: execute },
    ]);
    else execute();
  }
  if (!canRead) return null;
  const active = cards?.find((card) => card.status === "active");
  const button = (title: string, onPress: () => void) => <TouchableOpacity accessibilityRole="button" accessibilityLabel={title} disabled={working || mutationsBlocked} onPress={onPress} style={{ padding: 12, marginVertical: 4, backgroundColor: "#E8F4F1", borderRadius: 8, opacity: working || mutationsBlocked ? 0.5 : 1 }}><Text>{title}</Text></TouchableOpacity>;
  return <View testID="student-card-nfc-enrollment-panel">
    <Text>Cartes NFC NTAG213 / NTAG216</Text>
    {message ? <Text accessibilityLiveRegion="polite">{message}</Text> : null}
    {working ? <TouchableOpacity accessibilityRole="button" accessibilityLabel="Annuler la lecture NFC" onPress={() => { operation.current++; void hardware.current?.close(); setMessage("Lecture NFC annulée. Vous pouvez réessayer."); }} style={{ padding: 12 }}><Text>Annuler la lecture NFC</Text></TouchableOpacity> : null}
    {!cards ? <Text>Chargement ou service indisponible.</Text> : null}
    {cards?.map((card) => <View key={card.id} style={{ paddingVertical: 10 }}>
      <Text>Carte {card.publicId} — {cardStatusLabels[card.status] || "État inconnu"}</Text>
      {card.nfc ? <Text>{card.nfc.tagType} · UID {card.nfc.uid} · {labels[card.nfc.state]}</Text> : null}
      {canUpdate && enabled && Platform.OS === "android" && card.status === "active" && card.nfc ? <>
        {button("Relire et confirmer la carte", () => verify(card, false))}
        {card.nfc.state === "encoded" ? button("Verrouiller définitivement", () => verify(card, true)) : null}
        {card.nfc.state === "pending" ? button("Reprendre l’encodage", () => void retry(card)) : null}
        {card.nfc.state === "pending" ? button("Annuler cette affectation", () => Alert.alert("Annuler l’affectation ?", "L’identifiant de cette carte sera révoqué. L’UID restera dans l’historique.", [{ text: "Conserver", style: "cancel" }, { text: "Révoquer", style: "destructive", onPress: () => void run(async (_device, valid) => { await api.revoke(card.id); if (valid()) { issued.current = null; setIdentity(null); setMessage("Affectation révoquée."); } }) }])) : null}
      </> : null}
    </View>)}
    {Platform.OS !== "android" ? <Text>L’encodage NFC est disponible sur Android uniquement.</Text> : null}
    {cards && !enabled ? <Text>L’encodage NFC est désactivé pour cet établissement.</Text> : null}
    {mutationsBlocked ? <Text>Une connexion et des droits à jour sont nécessaires.</Text> : null}
    {canUpdate && enabled && Platform.OS === "android" && cards && (!active || issued.current) ? <>
      {identity ? <Text>{identity.tagType} · UID {identity.uid}</Text> : null}
      {!issued.current ? button("Lire l’UID d’une carte vierge", () => void inspect()) : null}
      {identity ? button(issued.current ? "Réessayer l’encodage" : "Encoder et affecter", () => void encode()) : null}
    </> : null}
  </View>;
}
