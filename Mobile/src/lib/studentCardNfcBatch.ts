/** Batch scheduling only: all NFC encoding remains in the individual #913 engine. */
import {
  createIndividualNfcFlow,
  nfcFailure,
  nfcErrorCopy,
  type EnrollmentCard,
  type NfcEnrollmentApi,
  type NfcEncoderHardware,
  type NfcPhase,
} from "./studentCardNfcEncoding";
export type BatchStudent = { id: string; name: string; code: string };
export type BatchRoster = {
  classId: string;
  classCode: string;
  className: string;
  students: BatchStudent[];
};
export type BatchEntry = {
  student: BatchStudent;
  cards: EnrollmentCard[];
  selected: boolean;
  member: boolean;
  intent: "create" | "resume" | "replace";
  targetId?: string;
  state: "queued" | "processing" | "confirmed" | "error" | "skipped";
  error: string | null;
  confirmedCardId?: string;
  confirmedOperationId?: string | null;
};
export type BatchMode =
  | "loading"
  | "preparation"
  | "running"
  | "pausing"
  | "paused"
  | "result"
  | "blocked"
  | "disposed";
export type BatchSnapshot = {
  mode: BatchMode;
  roster: BatchRoster | null;
  entries: BatchEntry[];
  currentId: string | null;
  phase: NfcPhase;
  message: string;
  counters: {
    total: number;
    programmed: number;
    remaining: number;
    errors: number;
    inProgress: number;
  };
};
// Whitelist metadata: capability/tokenHash and unrelated student data never enter a snapshot.
export function batchCardMetadata(card: EnrollmentCard): EnrollmentCard {
  return {
    id: card.id,
    publicId: card.publicId,
    medium: card.medium,
    status: card.status,
    revokeReason: card.revokeReason,
    nfc: card.nfc
      ? {
          uid: card.nfc.uid,
          tagType: card.nfc.tagType,
          state: card.nfc.state,
          operationId: card.nfc.operationId,
          expiresAt: card.nfc.expiresAt,
          replacesCardId: card.nfc.replacesCardId,
        }
      : null,
  };
}
export function batchCounters(entries: BatchEntry[]) {
  const selected = entries.filter((e) => e.selected);
  const programmed = selected.filter((e) => e.state === "confirmed").length;
  return {
    total: selected.length,
    programmed,
    remaining: selected.length - programmed,
    errors: selected.filter(
      (e) => e.state === "error" || (e.state === "skipped" && e.error !== null),
    ).length,
    inProgress: selected.filter((e) => e.state === "processing").length,
  };
}
export function eligibleForNewCard(entry: BatchEntry) {
  return (
    entry.member &&
    !entry.cards.some(
      (c) =>
        c.status === "active" ||
        (c.status === "issued" && c.nfc?.state === "pending"),
    )
  );
}
export function createNfcBatch(input: {
  classId: string;
  classCode: string;
  loadRoster(): Promise<BatchRoster>;
  api: NfcEnrollmentApi;
  hardware: NfcEncoderHardware;
  uuid(): string;
  valid(): boolean;
  changed(snapshot: BatchSnapshot): void;
}) {
  let mode: BatchMode = "preparation",
    roster: BatchRoster | null = null;
  let entries: BatchEntry[] = [],
    currentId: string | null = null,
    phase: NfcPhase = "initial",
    message = "";
  let cleanupBlocked = false;
  let epoch = 0,
    task: Promise<void> | null = null;
  const flows = new Map<string, ReturnType<typeof createIndividualNfcFlow>>();
  const snapshot = (): BatchSnapshot => ({
    mode,
    roster: roster
      ? { ...roster, students: roster.students.map((s) => ({ ...s })) }
      : null,
    entries: entries.map((e) => ({
      ...e,
      student: { ...e.student },
      cards: e.cards.map(batchCardMetadata),
    })),
    currentId,
    phase,
    message,
    counters: batchCounters(entries),
  });
  const isDisposed = () => mode === "disposed";
  const emit = () => {
    if (!isDisposed()) input.changed(snapshot());
  };
  function scopeFailure(error: unknown) {
    if (!input.valid()) return true;
    if (!error || typeof error !== "object") return false;
    const code = "code" in error ? error.code : "";
    return (
      [
        "NFC_SCOPE_DENIED",
        "STUDENT_CARD_TENANT_DENIED",
        "AUTH_REQUIRED",
        "SESSION_EXPIRED",
      ].includes(String(code)) ||
      ("status" in error && [401, 403].includes(Number(error.status))) ||
      ("statusCode" in error && [401, 403].includes(Number(error.statusCode)))
    );
  }
  function hideUnauthorizedRows() {
    roster = null;
    for (const e of entries) {
      e.student = {
        id: e.student.id,
        name: "Accès élève à vérifier",
        code: "",
      };
      e.cards = [];
      e.member = false;
    }
  }
  function check() {
    if (!input.valid() || mode === "disposed")
      throw nfcFailure("NFC_SCOPE_DENIED");
  }
  async function checkedRoster() {
    check();
    const value = await input.loadRoster();
    check();
    if (
      value.classId !== input.classId ||
      value.classCode !== input.classCode ||
      !Array.isArray(value.students) ||
      new Set(value.students.map((s) => s.id)).size !== value.students.length
    )
      throw nfcFailure("NFC_SCOPE_DENIED");
    return value;
  }
  function mutable() {
    check();
    if (cleanupBlocked) throw nfcFailure("NFC_SESSION_BUSY");
    if (task || mode === "running" || mode === "pausing")
      throw nfcFailure("NFC_BUSY");
  }
  function find(id: string) {
    const entry = entries.find((e) => e.student.id === id);
    if (!entry || !entry.member) throw nfcFailure("NFC_SCOPE_DENIED");
    return entry;
  }
  async function prepare() {
    mutable();
    const captured = ++epoch;
    mode = "loading";
    emit();
    const work = (async () => {
      try {
        const value = await checkedRoster();
        const next: BatchEntry[] = [];
        for (const student of value.students) {
          if (captured !== epoch) throw nfcFailure("NFC_CANCELLED");
          const response = await input.api.list(student.id);
          check();
          if (captured !== epoch) throw nfcFailure("NFC_CANCELLED");
          if (response.nfcEnabled !== true)
            throw nfcFailure("STUDENT_CARD_NFC_DISABLED");
          if (!Array.isArray(response.cards))
            throw nfcFailure("NFC_RESPONSE_INVALID");
          const old = entries.find((e) => e.student.id === student.id);
          const entry: BatchEntry = old
            ? Object.assign(old, {
                student: {
                  id: student.id,
                  name: student.name,
                  code: student.code,
                },
                member: true,
                cards: response.cards.map(batchCardMetadata),
              })
            : {
                student: {
                  id: student.id,
                  name: student.name,
                  code: student.code,
                },
                cards: response.cards.map(batchCardMetadata),
                member: true,
                selected: false,
                intent: "create",
                state: "queued",
                error: null,
              };
          if (
            entry.state === "confirmed" &&
            !entry.cards.some(
              (c) =>
                c.id === entry.confirmedCardId &&
                c.status === "active" &&
                c.nfc &&
                c.nfc.operationId === entry.confirmedOperationId &&
                ["encoded", "locked"].includes(c.nfc.state),
            )
          ) {
            entry.state = "error";
            entry.error = "La carte confirmée a changé. Relisez son état.";
          }
          next.push(entry);
        }
        if (captured !== epoch) throw nfcFailure("NFC_CANCELLED");
        for (const old of entries.filter(
          (e) => e.selected && !next.some((n) => n.student.id === e.student.id),
        ))
          next.push({
            ...old,
            student: {
              id: old.student.id,
              name: "Élève retiré de cette classe",
              code: "",
            },
            member: false,
            cards: [],
            state: "error",
            error: "L’élève n’appartient plus à cette classe.",
          });
        roster = {
          ...value,
          students: value.students.map((s) => ({
            id: s.id,
            name: s.name,
            code: s.code,
          })),
        };
        entries = next;
        mode = "preparation";
        message = "Sélectionnez les élèves à programmer.";
      } catch (error) {
        if (captured === epoch && !isDisposed()) {
          mode = "blocked";
          message = nfcErrorCopy(error);
          if (scopeFailure(error)) hideUnauthorizedRows();
        }
      } finally {
        if (!isDisposed()) emit();
      }
    })();
    task = work;
    try {
      await work;
    } finally {
      if (task === work) task = null;
    }
  }
  function flowFor(entry: BatchEntry) {
    let flow = flows.get(entry.student.id);
    if (flow) return flow;
    let activeEpoch = 0;
    const valid = () =>
      input.valid() &&
      epoch === activeEpoch &&
      mode === "running" &&
      currentId === entry.student.id;
    async function member() {
      if (!valid()) throw nfcFailure("NFC_CANCELLED");
      const value = await checkedRoster();
      if (!valid()) throw nfcFailure("NFC_CANCELLED");
      if (!value.students.some((s) => s.id === entry.student.id))
        throw nfcFailure("NFC_SCOPE_DENIED");
    }
    const guarded: NfcEnrollmentApi = {
      async list(id) {
        await member();
        const response = await input.api.list(id);
        if (!valid()) throw nfcFailure("NFC_CANCELLED");
        if (!Array.isArray(response.cards))
          throw nfcFailure("NFC_RESPONSE_INVALID");
        entry.cards = response.cards.map(batchCardMetadata);
        emit();
        return { ...response, cards: entry.cards.map(batchCardMetadata) };
      },
      async issue(...args) {
        await member();
        return input.api.issue(...args);
      },
      async replace(...args) {
        await member();
        return input.api.replace(...args);
      },
      async retry(...args) {
        await member();
        return input.api.retry(...args);
      },
      async confirm(...args) {
        await member();
        return input.api.confirm(...args);
      },
    };
    const individual = createIndividualNfcFlow({
      studentId: entry.student.id,
      api: guarded,
      hardware: input.hardware,
      uuid: input.uuid,
      valid,
      phase(next) {
        if (valid()) {
          phase = next;
          emit();
        }
      },
    });
    // Capture an epoch per invocation, never change it while that invocation is running.
    flow = {
      hasUncertainReservation: individual.hasUncertainReservation,
      program(previous) {
        activeEpoch = epoch;
        return individual.program(previous);
      },
      resume(card) {
        activeEpoch = epoch;
        return individual.resume(card);
      },
      rewrite(card, consent) {
        activeEpoch = epoch;
        return individual.rewrite(card, consent);
      },
    };
    flows.set(entry.student.id, flow);
    return flow;
  }
  async function process(entry: BatchEntry, rewrite: boolean) {
    const flow = flowFor(entry);
    if (flow.hasUncertainReservation() && !rewrite) return flow.resume();
    const response = await input.api.list(entry.student.id);
    check();
    if (mode !== "running") throw nfcFailure("NFC_CANCELLED");
    if (response.nfcEnabled !== true)
      throw nfcFailure("STUDENT_CARD_NFC_DISABLED");
    if (!Array.isArray(response.cards))
      throw nfcFailure("NFC_RESPONSE_INVALID");
    entry.cards = response.cards.map(batchCardMetadata);
    emit();
    const pending = entry.cards.find(
      (c) => c.status === "issued" && c.nfc?.state === "pending",
    );
    const target = entry.cards.find((c) => c.id === entry.targetId);
    if (rewrite) {
      if (!pending) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      return flow.rewrite(pending, true);
    }
    if (pending) return flow.resume(pending);
    if (entry.intent === "resume") {
      if (!target) throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      return flow.resume(target);
    }
    if (entry.intent === "replace") {
      if (!target || target.status !== "active")
        throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      return flow.program(target);
    }
    if (!eligibleForNewCard(entry)) throw nfcFailure("NFC_REPLACE_REQUIRED");
    return flow.program();
  }
  function pump(rewriteId?: string) {
    mutable();
    check();
    if (mode === "blocked") throw nfcFailure("NFC_SCOPE_DENIED");
    mode = "running";
    ++epoch;
    message = "";
    emit();
    const work = (async () => {
      try {
        while (mode === "running" && input.valid()) {
          const entry = entries.find(
            (e) => e.selected && e.member && e.state === "queued",
          );
          if (!entry) {
            mode = "result";
            break;
          }
          currentId = entry.student.id;
          entry.state = "processing";
          entry.error = null;
          phase = "waiting";
          emit();
          try {
            const value = await checkedRoster();
            if (
              mode !== "running" ||
              !value.students.some((s) => s.id === entry.student.id)
            )
              throw nfcFailure("NFC_SCOPE_DENIED");
            const confirmed = await process(
              entry,
              rewriteId === entry.student.id,
            );
            check();
            if (mode !== "running") throw nfcFailure("NFC_CANCELLED");
            if (
              confirmed.status !== "active" ||
              !confirmed.nfc ||
              !["encoded", "locked"].includes(confirmed.nfc.state)
            )
              throw nfcFailure("NFC_RESPONSE_INVALID");
            entry.state = "confirmed";
            entry.confirmedCardId = confirmed.id;
            entry.confirmedOperationId = confirmed.nfc.operationId;
            entry.cards = [batchCardMetadata(confirmed)];
          } catch (error) {
            entry.state = "error";
            entry.error = nfcErrorCopy(error);
            message = entry.error;
            if (mode === "running")
              mode = scopeFailure(error) ? "blocked" : "paused"; // Operator resolves this pupil before advancing.
            if (scopeFailure(error)) hideUnauthorizedRows();
          } finally {
            try {
              await input.hardware.close();
            } catch {
              cleanupBlocked = true;
              if (!isDisposed()) {
                mode = "blocked";
                message =
                  "La session NFC n’est pas libérée. Réessayez son annulation.";
              }
            }
            currentId = null;
            emit();
          }
        }
        if (!input.valid() && mode === "running") {
          mode = "blocked";
          message = nfcErrorCopy(nfcFailure("NFC_SCOPE_DENIED"));
        }
      } finally {
        if (!isDisposed()) emit();
      }
    })();
    task = work;
    return work.finally(() => {
      if (task === work) task = null;
    });
  }
  async function pause(finish = false) {
    if (isDisposed()) return;
    const pending = task;
    ++epoch;
    mode = "pausing";
    emit();
    const closing = input.hardware.close();
    const results = await Promise.allSettled([closing, pending]);
    if (isDisposed()) return;
    currentId = null;
    if (results.some((r) => r.status === "rejected")) {
      cleanupBlocked = true;
      mode = "blocked";
      message = "La session NFC n’est pas libérée. Réessayez son annulation.";
    } else {
      cleanupBlocked = false;
      mode = finish ? "result" : "paused";
      message = finish
        ? "Bilan de programmation"
        : "Session suspendue. Reprenez explicitement les opérations incomplètes.";
    }
    emit();
  }
  return {
    snapshot,
    prepare,
    select(
      id: string,
      selected: boolean,
      intent: BatchEntry["intent"] = "create",
      targetId?: string,
      consent = false,
    ) {
      mutable();
      const existing = entries.find((e) => e.student.id === id);
      if (existing && !selected && existing.state !== "confirmed") {
        existing.selected = false;
        emit();
        return;
      }
      const entry = find(id);
      if (entry.state === "confirmed") return;
      if (
        selected &&
        intent !== "resume" &&
        flows.get(id)?.hasUncertainReservation()
      )
        throw nfcFailure("NFC_PENDING");
      if (intent === "create" && !eligibleForNewCard(entry))
        throw nfcFailure("NFC_REPLACE_REQUIRED");
      if (
        intent === "replace" &&
        (!consent ||
          !entry.cards.some((c) => c.id === targetId && c.status === "active"))
      )
        throw nfcFailure("NFC_REPLACE_REQUIRED");
      if (
        intent === "resume" &&
        !entry.cards.some(
          (c) =>
            c.id === targetId &&
            ((c.status === "issued" && c.nfc?.state === "pending") ||
              (c.status === "active" && !!c.nfc)),
        )
      )
        throw nfcFailure("STUDENT_CARD_INVALID_STATE");
      entry.selected = selected;
      entry.intent = intent;
      entry.targetId = targetId;
      entry.state = "queued";
      entry.error = null;
      emit();
    },
    selectAll() {
      mutable();
      for (const e of entries)
        if (eligibleForNewCard(e) && e.state !== "confirmed") {
          e.selected = true;
          e.intent = "create";
          e.state = "queued";
          e.error = null;
        }
      emit();
    },
    deselectAll() {
      mutable();
      for (const e of entries) if (e.state !== "confirmed") e.selected = false;
      emit();
    },
    start() {
      return pump();
    },
    pause,
    finish() {
      return pause(true);
    },
    resume() {
      mutable();
      for (const e of entries)
        if (e.selected && e.state === "error" && e.member) e.state = "queued";
      return pump();
    },
    retry(id: string) {
      mutable();
      const e = find(id);
      e.selected = true;
      e.state = "queued";
      return pump();
    },
    rewrite(id: string, consent: boolean) {
      mutable();
      if (!consent) throw nfcFailure("NFC_REWRITE_REQUIRED");
      const e = find(id);
      e.selected = true;
      e.state = "queued";
      return pump(id);
    },
    async skip(id: string) {
      await pause();
      mutable();
      const e = entries.find((e) => e.student.id === id);
      if (!e) throw nfcFailure("NFC_SCOPE_DENIED");
      e.state = "skipped";
      return pump();
    },
    async dispose() {
      ++epoch;
      mode = "disposed";
      await Promise.allSettled([input.hardware.close(), task]);
      flows.clear();
      entries = [];
      roster = null;
      currentId = null;
    },
  };
}
