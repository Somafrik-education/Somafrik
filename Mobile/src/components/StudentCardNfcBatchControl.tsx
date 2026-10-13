import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  Modal,
  Platform,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { studentCardEnrollmentAccess } from "../lib/studentCardEnrollmentAccess";
import { studentCardNfcBatchRoster } from "../services/studentCardNfcBatchApi";
import { studentCardEnrollmentApi as api } from "../services/studentCardEnrollmentApi";
import { createIdempotencyKey } from "../lib/networkResilience";
import {
  createNfcBatch,
  eligibleForNewCard,
  type BatchSnapshot,
  type BatchEntry,
} from "../lib/studentCardNfcBatch";
import {
  NFC_PHASE_COPY,
  nfcErrorCopy,
  type NfcEncoderHardware,
} from "../lib/studentCardNfcEncoding";
import type { BatchScope } from "../lib/studentCardNfcBatchRoster";
import type { SchoolClass } from "../data/catalog";
const touch = {
  minHeight: 44,
  padding: 12,
  marginVertical: 4,
  backgroundColor: "#E8F4F1",
  borderRadius: 8,
};

type Props = { schoolClass: SchoolClass; mutationsBlocked: boolean };
export default function StudentCardNfcBatchControl({
  schoolClass,
  mutationsBlocked,
}: Props) {
  const { session, permissionsBootstrap } = useAuth();
  const focused = useIsFocused();
  const access = studentCardEnrollmentAccess(session);
  const schoolId = String(session?.user?.schoolId || session?.school?.id || "");
  const schoolCodes = [
    ...new Set(
      [
        session?.user?.schoolCode,
        session?.user?.schoolPublicCode,
        session?.school?.code,
        (session?.school as { loginCode?: string } | undefined)?.loginCode,
      ]
        .filter(Boolean)
        .map(String),
    ),
  ];
  const scope: BatchScope = {
    schoolId,
    schoolCodes,
    classId: String(schoolClass.id),
    classCode: String(schoolClass.classCode || schoolClass.publicId || ""),
  };
  const scopeKey = `${session?.user?.id}:${schoolId}:${scope.classId}:${scope.classCode}`;
  const authorized =
    !!session?.user?.id &&
    !!schoolId &&
    access.canUpdate &&
    permissionsBootstrap === "ready" &&
    !mutationsBlocked &&
    focused;
  const allowed = useRef(false);
  allowed.current = authorized;
  const foreground = useRef(AppState.currentState === "active");
  const [refresh, setRefresh] = useState(0);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      foreground.current = state === "active";
      if (foreground.current) setRefresh((n) => n + 1);
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    let current = true;
    setAvailable(false);
    if (!authorized || Platform.OS !== "android") return;
    setChecking(true);
    void (async () => {
      const roster = await studentCardNfcBatchRoster(scope)();
      if (!current) return;
      if (!roster.students.length) {
        setMessage("Cette classe ne contient aucun élève à programmer.");
        return;
      }
      const flags = await api.list(roster.students[0].id);
      if (!current) return;
      if (flags.nfcEnabled !== true) {
        setMessage(
          "La programmation NFC est désactivée pour cet établissement.",
        );
        return;
      }
      const { createNfcEncoderHardware } = await import(
        "../lib/studentCardNfcEncoderNative"
      );
      if (!current) return;
      await createNfcEncoderHardware().availability();
      if (current) {
        setAvailable(true);
        setMessage("");
      }
    })()
      .catch((error) => {
        if (current) setMessage(nfcErrorCopy(error));
      })
      .finally(() => {
        if (current) setChecking(false);
      });
    return () => {
      current = false;
    };
  }, [scopeKey, authorized, refresh]);
  if (!access.canUpdate || Platform.OS !== "android") return null;
  return (
    <View testID="student-card-nfc-batch-control">
      {checking ? (
        <ActivityIndicator accessibilityLabel="Vérification de la programmation NFC" />
      ) : null}
      {message ? <Text>{message}</Text> : null}
      {available && authorized ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={touch}
          onPress={() => setVisible(true)}
        >
          <Text>Programmer les cartes NFC</Text>
        </TouchableOpacity>
      ) : null}
      {!available && authorized && !checking ? (
        <TouchableOpacity
          accessibilityRole="button"
          style={touch}
          onPress={() => setRefresh((n) => n + 1)}
        >
          <Text>Vérifier à nouveau le NFC</Text>
        </TouchableOpacity>
      ) : null}
      {visible && authorized ? (
        <StudentCardNfcBatchSession
          key={scopeKey}
          scope={scope}
          valid={() => allowed.current && foreground.current}
          onClosed={() => {
            setVisible(false);
            setRefresh((n) => n + 1);
          }}
        />
      ) : null}
    </View>
  );
}

function StudentCardNfcBatchSession({
  scope,
  valid,
  onClosed,
}: {
  scope: BatchScope;
  valid(): boolean;
  onClosed(): void;
}) {
  const controller = useRef<ReturnType<typeof createNfcBatch> | null>(null);
  const hardware = useRef<NfcEncoderHardware | null>(null);
  const live = useRef(true);
  const validRef = useRef(valid);
  validRef.current = valid;
  const [state, setState] = useState<BatchSnapshot | null>(null);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  useEffect(() => {
    live.current = true;
    void (async () => {
      const { createNfcEncoderHardware } = await import(
        "../lib/studentCardNfcEncoderNative"
      );
      if (!live.current || !validRef.current()) return;
      hardware.current = createNfcEncoderHardware((text) => {
        if (live.current && validRef.current()) setPrompt(text);
      });
      const batch = createNfcBatch({
        classId: scope.classId,
        classCode: scope.classCode,
        loadRoster: studentCardNfcBatchRoster(scope),
        api,
        hardware: hardware.current,
        uuid: createIdempotencyKey,
        valid: () => live.current && validRef.current(),
        changed: (next) => {
          if (live.current) {
            setState(next);
            if (next.phase !== "writing") setPrompt("");
          }
        },
      });
      controller.current = batch;
      await batch.prepare();
    })().catch((e) => {
      if (live.current) setError(nfcErrorCopy(e));
    });
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") void controller.current?.pause().catch(() => {});
    });
    return () => {
      live.current = false;
      sub.remove();
      void controller.current?.dispose().catch(() => {});
    };
  }, []);
  async function act(action: () => unknown | Promise<unknown>) {
    setError("");
    try {
      await action();
    } catch (e) {
      if (live.current) setError(nfcErrorCopy(e));
    }
  }
  async function close() {
    if (!controller.current) {
      onClosed();
      return;
    }
    await controller.current.finish();
    if (live.current && controller.current.snapshot().mode === "result")
      onClosed();
  }
  const busy =
    state?.mode === "running" ||
    state?.mode === "pausing" ||
    state?.mode === "loading";
  const button = (
    label: string,
    action: () => unknown | Promise<unknown>,
    disabled = !!busy,
  ) => (
    <TouchableOpacity
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      style={[touch, { opacity: disabled ? 0.45 : 1 }]}
      onPress={() => void act(action)}
    >
      <Text>{label}</Text>
    </TouchableOpacity>
  );
  const row = (entry: BatchEntry) => {
    const pending = entry.cards.find(
      (c) => c.status === "issued" && c.nfc?.state === "pending",
    );
    const active = entry.cards.find((c) => c.status === "active");
    const eligible = eligibleForNewCard(entry);
    const choice = eligible ? "create" : pending ? "resume" : null;
    const status =
      entry.state === "confirmed"
        ? "Carte programmée et active"
        : pending
          ? "Réservation en attente — non active"
          : active
            ? "Carte active"
            : "Aucune carte active";
    return (
      <View
        style={{ padding: 12, borderBottomWidth: 1, borderColor: "#DDE3EA" }}
      >
        <Text style={{ fontWeight: "700" }}>{entry.student.name}</Text>
        <Text>{entry.student.code}</Text>
        <Text>{status}</Text>
        {pending?.nfc?.expiresAt ? (
          <Text>
            Expiration de la réservation :{" "}
            {Number.isFinite(Date.parse(pending.nfc.expiresAt))
              ? new Date(pending.nfc.expiresAt).toLocaleString()
              : "À vérifier auprès du serveur"}
          </Text>
        ) : null}
        {entry.error ? <Text>{entry.error}</Text> : null}
        {entry.state === "skipped" ? (
          <Text>Élève ignoré — reste à traiter</Text>
        ) : null}
        {choice && entry.state !== "confirmed" ? (
          <TouchableOpacity
            accessibilityRole="checkbox"
            accessibilityState={{ checked: entry.selected, disabled: !!busy }}
            disabled={!!busy}
            style={touch}
            onPress={() =>
              void act(() =>
                controller.current?.select(
                  entry.student.id,
                  !entry.selected,
                  choice,
                  pending?.id,
                ),
              )
            }
          >
            <Text>
              {entry.selected ? "☑" : "☐"}{" "}
              {pending ? "Sélectionner pour reprendre" : "Sélectionner"}
            </Text>
          </TouchableOpacity>
        ) : null}
        {active && entry.state !== "confirmed" ? (
          <>
            {active.nfc
              ? button("Reprendre et vérifier la carte active", () =>
                  controller.current?.select(
                    entry.student.id,
                    true,
                    "resume",
                    active.id,
                  ),
                )
              : null}
            {button("Préparer un remplacement", () =>
              Alert.alert(
                "Confirmer le remplacement",
                `L’ancienne carte de ${entry.student.name} restera active jusqu’à la confirmation serveur de la nouvelle carte.`,
                [
                  { text: "Annuler", style: "cancel" },
                  {
                    text: "Sélectionner pour remplacer",
                    onPress: () =>
                      void act(() =>
                        controller.current?.select(
                          entry.student.id,
                          true,
                          "replace",
                          active.id,
                          true,
                        ),
                      ),
                  },
                ],
              ),
            )}
          </>
        ) : null}
        {entry.selected && entry.state !== "confirmed" && !choice
          ? button("Désélectionner cet élève", () =>
              controller.current?.select(entry.student.id, false),
            )
          : null}
        {entry.state === "processing"
          ? button(
              "Ignorer cet élève après annulation sûre",
              () => controller.current?.skip(entry.student.id),
              state?.mode === "pausing",
            )
          : null}
        {entry.selected &&
        (entry.state === "error" || entry.state === "skipped") ? (
          <>
            {button("Réessayer — relire l’état existant", () =>
              controller.current?.retry(entry.student.id),
            )}
            {pending
              ? button("Renouveler et réécrire avec confirmation", () =>
                  Alert.alert(
                    "Confirmer la réécriture",
                    "Relisez d’abord la carte si une confirmation est incertaine. Cette action renouvelle le secret de la réservation et peut réécrire la même carte, sans prolonger son expiration.",
                    [
                      { text: "Annuler", style: "cancel" },
                      {
                        text: "Renouveler et écrire",
                        onPress: () =>
                          void act(() =>
                            controller.current?.rewrite(entry.student.id, true),
                          ),
                      },
                    ],
                  ),
                )
              : null}
            {button("Ignorer cet élève et continuer", () =>
              controller.current?.skip(entry.student.id),
            )}
          </>
        ) : null}
        {entry.selected && entry.intent === "replace" ? (
          <Text>Remplacement explicitement sélectionné</Text>
        ) : null}
      </View>
    );
  };
  return (
    <Modal visible animationType="slide" onRequestClose={() => void act(close)}>
      <View
        style={{
          flex: 1,
          paddingTop: 48,
          paddingHorizontal: 16,
          backgroundColor: "#FFFFFF",
        }}
        testID="student-card-nfc-batch-session"
      >
        <FlatList
          data={state?.entries || []}
          keyExtractor={(entry) => entry.student.id}
          renderItem={({ item }) => row(item)}
          ListHeaderComponent={
            <>
              <Text style={{ fontSize: 22, fontWeight: "700" }}>
                {state?.mode === "result"
                  ? "Bilan de programmation"
                  : state?.mode === "running"
                    ? "Programmation en cours"
                    : "Programmation des cartes NFC"}
              </Text>
              <Text>
                Classe : {state?.roster?.className || scope.classCode}
              </Text>
              {!state || state.mode === "loading" ? (
                <ActivityIndicator accessibilityLabel="Chargement de la classe et des cartes" />
              ) : null}
              {state ? (
                <Text accessibilityLiveRegion="polite">
                  Total : {state.counters.total} · Programmées :{" "}
                  {state.counters.programmed} · Restantes :{" "}
                  {state.counters.remaining} · Erreurs : {state.counters.errors}{" "}
                  · En cours : {state.counters.inProgress}
                </Text>
              ) : null}
              {state?.currentId ? (
                <Text>
                  Élève courant :{" "}
                  {
                    state.entries.find((e) => e.student.id === state.currentId)
                      ?.student.name
                  }
                </Text>
              ) : null}
              {state?.mode === "running" ? (
                <Text accessibilityLiveRegion="polite">
                  {NFC_PHASE_COPY[state.phase]}
                </Text>
              ) : null}
              {prompt ? <Text>{prompt}</Text> : null}
              {state?.message ? <Text>{state.message}</Text> : null}
              {error ? <Text>{error}</Text> : null}
              {state && !state.entries.length ? (
                <Text>Cette classe ne contient aucun élève à programmer.</Text>
              ) : null}
              {state?.mode === "preparation" ? (
                <>
                  {button("Sélectionner tous les élèves éligibles", () =>
                    controller.current?.selectAll(),
                  )}
                  {button("Désélectionner", () =>
                    controller.current?.deselectAll(),
                  )}
                  {button(
                    "Commencer",
                    () => controller.current?.start(),
                    state.counters.total === 0,
                  )}
                </>
              ) : null}
              {state?.mode === "running"
                ? button(
                    "Mettre en pause",
                    () => controller.current?.pause(),
                    false,
                  )
                : null}
              {state?.mode === "pausing" ? (
                <Text>Annulation en cours. Attendez la libération du NFC.</Text>
              ) : null}
              {state &&
              ["paused", "result"].includes(state.mode) &&
              state.counters.remaining > 0
                ? button("Reprendre la session", () =>
                    controller.current?.resume(),
                  )
                : null}
              {state && !busy
                ? button("Actualiser la classe et les états Backend", () =>
                    controller.current?.prepare(),
                  )
                : null}
              {button(
                "Terminer la session",
                () => controller.current?.finish(),
                state?.mode === "pausing",
              )}
              {button("Fermer le bilan", close, state?.mode === "pausing")}
            </>
          }
        />
      </View>
    </Modal>
  );
}
