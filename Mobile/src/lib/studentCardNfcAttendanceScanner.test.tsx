// NFC-PRESENCE-01 — individual NFC attendance: real React effects (react-dom on a minimal host),
// mocked NFC hardware and mocked API. No device, no network, no token in output.
import assert from "node:assert/strict";
import React, { act, useState } from "react";
import type { NfcHardware } from "./studentCardNfc";
import type { StudentCardScanResolved, StudentCardScanView } from "./studentCardScan";
import {
  NFC_ATTENDANCE_COPY,
  nfcScannerPanelText,
  nfcScannerRetryLabel,
  useNfcAttendanceScanner,
  type NfcAttendanceScanner,
  type NfcAttendanceScannerApi,
} from "./studentCardNfcAttendanceScanner";

class HTMLIFrameElement {}
const g = globalThis as Record<string, unknown>;
g.window = { event: undefined, HTMLIFrameElement, document: { activeElement: null } };
g.IS_REACT_ACT_ENVIRONMENT = true;
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createRoot } = require("react-dom/client") as {
  createRoot: (container: Element) => { render: (node: React.ReactNode) => void; unmount: () => void };
};

function hostContainer() {
  const node: Record<string, unknown> = {
    nodeType: 1, nodeName: "DIV", tagName: "DIV", namespaceURI: "http://www.w3.org/1999/xhtml",
    childNodes: [], textContent: "", addEventListener() {}, removeEventListener() {}, appendChild() {}, removeChild() {},
  };
  node.ownerDocument = { addEventListener() {}, removeEventListener() {}, defaultView: null, documentElement: node };
  return node as unknown as Element;
}

const TOKEN = `${"A".repeat(22)}.${"B".repeat(43)}`;
function textRecord(text: string, lang = "fr") {
  return { type: "T", payload: [lang.length, ...Array.from(lang + text).map((c) => c.charCodeAt(0))] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** One tag per requestTag(); further reads wait until the test releases them. */
function hardware() {
  const gates: Array<ReturnType<typeof deferred<void>>> = [];
  const hw: NfcHardware & { reads: number; present: () => void } = {
    reads: 0,
    async start() {},
    async isSupported() { return true; },
    async isEnabled() { return true; },
    async requestTag() {
      hw.reads += 1;
      const gate = deferred<void>();
      gates.push(gate);
      await gate.promise;
    },
    async getTag() { return { ndefMessage: [textRecord(`somafrik:card:${TOKEN}`)] }; },
    async cancel() {},
    present() { gates.find((x) => !(x as { done?: boolean }).done && ((x as { done?: boolean }).done = true))?.resolve(); },
  };
  return hw;
}

const RESOLVED: StudentCardScanResolved = {
  card: { status: "active" },
  student: { id: "stu-1", studentCode: "M-001", firstName: "Grâce", lastName: "Élève" },
  class: { id: "class-2b", classCode: "2B", className: "2ème B" },
} as StudentCardScanResolved;

type ApiControl = {
  api: NfcAttendanceScannerApi;
  calls: string[];
  records: { expectedClassId?: string; idempotencyKey: string }[];
  resolveGate?: Promise<void>;
};
function apiMock(over: Partial<NfcAttendanceScannerApi> = {}, resolveGate?: Promise<void>): ApiControl {
  const calls: string[] = [];
  const records: { expectedClassId?: string; idempotencyKey: string }[] = [];
  const control: ApiControl = {
    calls,
    records,
    api: {
      async resolveCard() { calls.push("resolve"); if (resolveGate) await resolveGate; return RESOLVED; },
      async recordAttendance(_token, attendance, idempotencyKey) {
        // NFC-PERF-02 : l'unique requête porte la classe attendue et la clé d'idempotence.
        calls.push(`record:${attendance.status}:${attendance.date}`);
        records.push({ expectedClassId: attendance.expectedClassId, idempotencyKey });
        if (resolveGate) await resolveGate;
        return { ...RESOLVED, attendance: { status: "present", date: attendance.date } };
      },
      readFinance: undefined,
      createIdempotencyKey: () => "idem-0001",
      ...over,
    },
  };
  return control;
}

type Harness = {
  scanner: () => NfcAttendanceScanner;
  recorded: StudentCardScanView[];
  parentRenders: () => number;
  bumpParent: () => Promise<void>;
  setVisible: (visible: boolean) => Promise<void>;
  setClass: (classId: string, classCode: string) => Promise<void>;
  unmount: () => Promise<void>;
};

/**
 * Mirrors TeacherAttendanceScreen: inline props recreated on every render, and the
 * attendance callback updates parent state (setAttendance + loadPresences => re-render).
 */
async function mount(hw: NfcHardware, control: ApiControl): Promise<Harness> {
  const recorded: StudentCardScanView[] = [];
  let latest: NfcAttendanceScanner | null = null;
  let renders = 0;
  let bump: () => void = () => {};
  let setVisibleState: (v: boolean) => void = () => {};
  let setClassState: (c: { classId: string; classCode: string }) => void = () => {};

  type ScannerProps = Omit<Parameters<typeof useNfcAttendanceScanner>[0], "hardware" | "api" | "isOffline">;
  function Scanner(props: ScannerProps) {
    // Child component, like StudentCardNfcScannerModal: its own state never re-renders the parent.
    latest = useNfcAttendanceScanner({ ...props, hardware: hw, api: control.api, isOffline: () => false });
    return null;
  }

  function Parent() {
    renders += 1;
    const [, setTick] = useState(0);
    const [visible, setVisible] = useState(true);
    const [klass, setKlass] = useState({ classId: "class-2b", classCode: "2B" });
    bump = () => setTick((n) => n + 1);
    setVisibleState = setVisible;
    setClassState = setKlass;
    return (
      <Scanner
        visible={visible}
        resourceScopeKey="school-1"
        schoolCode="SOMA"
        selectedClass={{ ...klass }}
        author={{ status: "teacher_session" }}
        attendanceDate="2026-10-17"
        financeEnabled={false}
        onAttendanceRecorded={(view) => {
          recorded.push(view);
          setTick((n) => n + 1); // parent roll call update (setAttendance + loadPresences)
        }}
      />
    );
  }

  const root = createRoot(hostContainer());
  await act(async () => { root.render(<Parent />); });
  return {
    scanner: () => latest!,
    recorded,
    parentRenders: () => renders,
    bumpParent: async () => { await act(async () => { bump(); }); },
    setVisible: async (v) => { await act(async () => { setVisibleState(v); }); },
    setClass: async (classId, classCode) => { await act(async () => { setClassState({ classId, classCode }); }); },
    unmount: async () => { await act(async () => { root.unmount(); }); },
  };
}

async function settle() {
  await act(async () => { for (let i = 0; i < 20; i += 1) await Promise.resolve(); });
}

async function present(hw: ReturnType<typeof hardware>) {
  await act(async () => { hw.present(); });
  await settle();
}

const cases: Array<[string, () => Promise<void>]> = [
  ["PRES-01 recorded presence stays on screen after the parent re-renders", async () => {
    const hw = hardware(); const control = apiMock();
    const h = await mount(hw, control);
    assert.equal(h.scanner().scanning, true);
    const rendersBefore = h.parentRenders();
    await present(hw);
    // NFC-PERF-02 : une seule requête — aucune résolution préalable, classe attendue transmise.
    assert.deepEqual(control.calls, ["record:present:2026-10-17"]);
    assert.deepEqual(control.records, [{ expectedClassId: "class-2b", idempotencyKey: "idem-0001" }]);
    assert.equal(h.recorded.length, 1, "roll call notified once");
    assert.ok(h.parentRenders() > rendersBefore, "parent re-rendered like TeacherAttendanceScreen");
    const s = h.scanner();
    assert.equal(s.result?.studentName, "Grâce Élève");
    assert.equal(s.result?.attendanceRecorded, true);
    assert.equal(s.busy, false); assert.equal(s.scanning, false); assert.equal(s.error, "");
    assert.equal(hw.reads, 1, "the read is not restarted behind the user's back");
    assert.equal(nfcScannerPanelText(s), "Présence enregistrée");
    assert.equal(nfcScannerRetryLabel(s.result), "Scanner une autre carte");
    await h.bumpParent(); await h.bumpParent();
    assert.equal(h.scanner().result?.studentName, "Grâce Élève", "further parent renders keep the result");
    assert.equal(hw.reads, 1);
    await h.unmount();
  }],
  ["PRES-02 parent re-render during identification does not cancel the scan", async () => {
    const hw = hardware(); const gate = deferred<void>(); const control = apiMock({}, gate.promise);
    const h = await mount(hw, control);
    await present(hw);
    assert.equal(h.scanner().busy, true);
    assert.equal(nfcScannerPanelText(h.scanner()), "Identification en cours…");
    await h.bumpParent(); await h.bumpParent();
    await act(async () => { gate.resolve(); });
    await settle();
    const s = h.scanner();
    assert.equal(s.busy, false, "busy released");
    assert.equal(s.result?.attendanceRecorded, true);
    assert.equal(h.recorded.length, 1);
    await h.unmount();
  }],
  ["PRES-03 server refusals are shown, never silent (rights, enrollment, card state)", async () => {
    for (const [code, expected] of [
      ["PERMISSION_DENIED", "Action non autorisée."],
      ["STUDENT_CARD_ENROLLMENT_UNRESOLVED", "L’élève n’est pas rattaché à une classe active."],
      ["STUDENT_CARD_ATTENDANCE_DISABLED", "Le pointage par carte est désactivé."],
      ["ATTENDANCE_TEACHER_UNRESOLVED", "Choisissez l’enseignant auteur de l’appel avant de pointer."],
    ] as const) {
      const hw = hardware();
      const control = apiMock({
        async recordAttendance() { throw Object.assign(new Error("refused"), { code }); },
      });
      const h = await mount(hw, control);
      await present(hw);
      const s = h.scanner();
      assert.equal(s.error, expected, code);
      assert.equal(nfcScannerPanelText(s), expected, code);
      assert.equal(s.busy, false, code); assert.equal(h.recorded.length, 0, code);
      await h.unmount();
    }
  }],
  ["PRES-04 card of another class: the server refuses before writing (409), explicit message, no presence", async () => {
    const hw = hardware();
    const attempts: (string | undefined)[] = [];
    const control = apiMock({
      async resolveCard() { throw new Error("resolver must be skipped for NFC"); },
      async recordAttendance(_token, attendance) {
        attempts.push(attendance.expectedClassId);
        throw Object.assign(new Error("mismatch"), { status: 409, code: "STUDENT_CARD_CLASS_MISMATCH" });
      },
    });
    const h = await mount(hw, control);
    await present(hw);
    const s = h.scanner();
    assert.deepEqual(attempts, ["class-2b"], "la classe sélectionnée est soumise au contrôle serveur");
    assert.equal(s.error, "Cette carte n’appartient pas à la classe actuellement sélectionnée.");
    assert.notEqual(s.result?.attendanceRecorded, true); assert.equal(h.recorded.length, 0);
    assert.equal(s.busy, false);
    await h.unmount();
  }],
  ["PRES-04b defence in depth: a confirmed response for another class is never shown as a presence", async () => {
    const hw = hardware();
    const control = apiMock({
      async recordAttendance(_token, attendance) {
        return { ...RESOLVED, class: { id: "class-3a", classCode: "3A", className: "3ème A" }, attendance: { status: "present", date: attendance.date } } as StudentCardScanResolved;
      },
    });
    const h = await mount(hw, control);
    await present(hw);
    assert.equal(h.scanner().error, "Cette carte n’appartient pas à la classe actuellement sélectionnée.");
    assert.equal(h.recorded.length, 0);
    await h.unmount();
  }],
  ["PRES-04c invalid card or other school: refused by the single request, no presence", async () => {
    for (const [status, code] of [[409, "STUDENT_CARD_INVALID_STATE"], [404, "STUDENT_CARD_NOT_FOUND"]] as const) {
      const hw = hardware();
      let attempts = 0;
      const control = apiMock({
        async resolveCard() { throw new Error("resolver must be skipped for NFC"); },
        async recordAttendance() { attempts += 1; throw Object.assign(new Error("refused"), { status, code }); },
      });
      const h = await mount(hw, control);
      await present(hw);
      const s = h.scanner();
      assert.notEqual(s.error, "", code);
      assert.equal(h.recorded.length, 0, code);
      assert.notEqual(s.result?.attendanceRecorded, true, code);
      assert.equal(attempts, 1, `${code}: une seule requête, aucune résolution préalable`);
      await h.unmount();
    }
  }],
  ["PRES-05 unexpected exception before the API call: explicit error, busy released", async () => {
    const hw = hardware();
    const control = apiMock();
    const h = await mount(hw, control);
    const originalCreate = control.api.createIdempotencyKey;
    control.api.createIdempotencyKey = () => TOKEN; // unsafe key => assertIdempotencyKeySafe throws inside the flow
    await present(hw);
    assert.equal(h.scanner().busy, false);
    assert.notEqual(h.scanner().error, "");
    assert.equal(h.recorded.length, 0);
    control.api.createIdempotencyKey = originalCreate;
    await h.unmount();
  }],
  ["PRES-06 closing while the single request is in flight: nothing displayed, no second request, busy released", async () => {
    const hw = hardware(); const gate = deferred<void>(); const control = apiMock({}, gate.promise);
    const h = await mount(hw, control);
    await present(hw);
    await h.setVisible(false);
    await act(async () => { gate.resolve(); });
    await settle();
    const s = h.scanner();
    assert.equal(s.result, null); assert.equal(s.busy, false);
    // NFC-PERF-02 : la requête unique est partie avant la fermeture (le serveur peut l'avoir écrite) ;
    // aucune autre requête n'est envoyée et rien n'est affiché ni notifié à l'appel.
    assert.deepEqual(control.calls, ["record:present:2026-10-17"], "exactly the request sent before closing");
    assert.equal(h.recorded.length, 0);
    await h.unmount();
  }],
  ["PRES-07 class changed while the request is in flight: never applied to the new class", async () => {
    const hw = hardware(); const gate = deferred<void>(); const control = apiMock({}, gate.promise);
    const h = await mount(hw, control);
    await present(hw);
    await h.setClass("class-3a", "3A");
    await act(async () => { gate.resolve(); });
    await settle();
    // La requête porte la classe sélectionnée au moment du scan (vérifiée par le serveur),
    // jamais la nouvelle classe ; le résultat périmé n'est ni affiché ni notifié.
    assert.deepEqual(control.records.map((r) => r.expectedClassId), ["class-2b"]);
    assert.equal(h.recorded.length, 0);
    assert.equal(h.scanner().busy, false);
    await h.unmount();
  }],
  ["PRES-08 'Scanner une autre carte' clears the result and reads again", async () => {
    const hw = hardware(); const control = apiMock();
    const h = await mount(hw, control);
    await present(hw);
    assert.ok(h.scanner().result);
    await act(async () => { h.scanner().retry(); });
    assert.equal(h.scanner().result, null); assert.equal(h.scanner().scanning, true);
    assert.equal(hw.reads, 2);
    await present(hw);
    assert.equal(h.recorded.length, 2);
    await h.unmount();
  }],
  ["PRES-09 copy: a stale outcome while open is reported, never silent", async () => {
    assert.match(NFC_ATTENDANCE_COPY.interrupted, /réessayez/);
    assert.equal(nfcScannerPanelText({ busy: false, scanning: false, error: "", result: null }), "Approchez la carte…");
  }],
];

(async () => {
  for (const [name, run] of cases) {
    await run();
    console.log(`ok - ${name}`);
  }
  console.log("studentCardNfcAttendanceScanner.test: SUCCESS");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
