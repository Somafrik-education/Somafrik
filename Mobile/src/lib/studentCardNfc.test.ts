import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_NFC_PERMISSION,
  NFC_V1_PREFIX,
  STUDENT_CARD_NFC_COPY,
  decideNfcScannerForeground,
  extractNfcCardTokenFromTag,
  nfcFailureMessage,
  parseSomafrikCardToken,
  probeNfc,
  scanNfcCardToken,
  type NfcHardware,
} from "./studentCardNfc";
import {
  holdCardToken,
  isAttendanceAuthorReady,
  isStudentCardNfcAttendanceScanEnabled,
  isStudentCardNfcFinanceEnabled,
  isStudentCardNfcScannerVisible,
  isStudentCardQrScannerVisible,
  releaseCardToken,
  runStudentCardScanFlow,
  sanitizeStudentCardCapabilities,
  type VolatileCardToken,
} from "./studentCardScan";

const VALID = `${NFC_V1_PREFIX}synthetic.token`;
const validClass = { classId: "cls-1", classCode: "5A" };

function uriRecord(text: string, identifier = 0x00) {
  return {
    type: "U",
    payload: [identifier, ...Array.from(text).map((char) => char.charCodeAt(0))],
  };
}

function textRecord(text: string, lang = "en") {
  return {
    type: "T",
    payload: [lang.length, ...Array.from(lang + text).map((char) => char.charCodeAt(0))],
  };
}

function fakeHardware(overrides: Partial<NfcHardware> & { tag?: unknown } = {}): NfcHardware & { calls: string[] } {
  const calls: string[] = [];
  const hardware: NfcHardware & { calls: string[] } = {
    calls,
    async start() {
      calls.push("start");
    },
    async isSupported() {
      calls.push("isSupported");
      return true;
    },
    async isEnabled() {
      calls.push("isEnabled");
      return true;
    },
    async requestNdef() {
      calls.push("requestNdef");
    },
    async getTag() {
      calls.push("getTag");
      return (overrides.tag as { ndefMessage?: unknown; id?: unknown } | null) ?? null;
    },
    async cancel() {
      calls.push("cancel");
    },
  };
  return Object.assign(hardware, overrides);
}

assert.equal(
  CANONICAL_NFC_PERMISSION,
  "Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.",
);
assert.equal(STUDENT_CARD_NFC_COPY.button, "Scanner NFC");
assert.equal(STUDENT_CARD_NFC_COPY.disabled, "NFC désactivé sur cet appareil.");
assert.equal(STUDENT_CARD_NFC_COPY.useQr, "Utiliser QR");

const nfcOn = {
  studentCardEnabled: true,
  studentCardNfcEnabled: true,
  studentCardAttendanceEnabled: true,
  studentCardQrEnabled: false,
};
assert.equal(isStudentCardNfcAttendanceScanEnabled(nfcOn), true);
assert.equal(
  isStudentCardNfcScannerVisible({
    canUpdatePresences: true,
    settings: nfcOn,
    selectedClass: validClass,
  }),
  true,
);
assert.equal(
  isStudentCardQrScannerVisible({
    canUpdatePresences: true,
    settings: nfcOn,
    selectedClass: validClass,
  }),
  false,
  "NFC on ne force pas QR",
);

assert.equal(
  isStudentCardNfcScannerVisible({
    canUpdatePresences: true,
    settings: { ...nfcOn, studentCardEnabled: false },
    selectedClass: validClass,
  }),
  false,
  "NFC-08 master off",
);
assert.equal(
  isStudentCardNfcScannerVisible({
    canUpdatePresences: true,
    settings: { ...nfcOn, studentCardNfcEnabled: false },
    selectedClass: validClass,
  }),
  false,
  "NFC-09 flag NFC off",
);
assert.equal(
  isStudentCardNfcScannerVisible({
    canUpdatePresences: true,
    settings: { ...nfcOn, studentCardNfcEnabled: null as unknown as boolean },
    selectedClass: validClass,
  }),
  false,
);
assert.equal(
  isStudentCardNfcFinanceEnabled({
    studentCardEnabled: true,
    studentCardNfcEnabled: true,
    studentCardFinanceCheckEnabled: true,
  }),
  true,
  "NFC-15 finance informatif gated",
);
assert.equal(
  isStudentCardNfcFinanceEnabled({
    studentCardEnabled: true,
    studentCardNfcEnabled: true,
    studentCardFinanceCheckEnabled: false,
  }),
  false,
);

const sanitized = sanitizeStudentCardCapabilities({
  studentCardEnabled: true,
  studentCardNfcEnabled: "true",
  studentCardQrEnabled: true,
});
assert.equal(sanitized?.studentCardNfcEnabled, false);

assert.deepEqual(parseSomafrikCardToken(VALID), { ok: true, token: "synthetic.token" });
function failReason(result: { ok: true; token: string } | { ok: false; reason: string }): string {
  assert.equal(result.ok, false);
  return result.ok === false ? result.reason : "";
}

assert.equal(parseSomafrikCardToken("synthetic.token").ok, false);
assert.equal(failReason(parseSomafrikCardToken("https://example.test/card")), "invalid_prefix");
assert.equal(failReason(parseSomafrikCardToken('{"cardToken":"x.y"}')), "invalid_prefix");
assert.equal(failReason(parseSomafrikCardToken("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig")), "invalid_prefix");
assert.equal(failReason(parseSomafrikCardToken(`${NFC_V1_PREFIX}eyJ.eyJ.sig`)), "invalid_token");
assert.equal(failReason(parseSomafrikCardToken(`${NFC_V1_PREFIX}EL-SEQ5`)), "invalid_token");
assert.equal(failReason(parseSomafrikCardToken(`${NFC_V1_PREFIX}`)), "invalid_token");
assert.equal(failReason(parseSomafrikCardToken(`${NFC_V1_PREFIX}onlyone`)), "invalid_token");

assert.deepEqual(
  extractNfcCardTokenFromTag({ ndefMessage: [uriRecord(VALID)] }),
  { ok: true, token: "synthetic.token" },
  "NFC-03 URI NDEF",
);
assert.deepEqual(
  extractNfcCardTokenFromTag({ ndefMessage: [textRecord(VALID)] }),
  { ok: true, token: "synthetic.token" },
);
assert.equal(failReason(extractNfcCardTokenFromTag({ ndefMessage: [] })), "empty", "NFC-04");
assert.equal(failReason(extractNfcCardTokenFromTag(null)), "empty");
assert.equal(failReason(extractNfcCardTokenFromTag({ id: "04AABBCC" })), "uid_only", "NFC-16");
assert.equal(failReason(extractNfcCardTokenFromTag({})), "not_ndef", "NFC-05");
assert.equal(
  failReason(extractNfcCardTokenFromTag({ ndefMessage: [uriRecord("https://example.test")] })),
  "invalid_prefix",
  "NFC-06",
);
assert.equal(
  failReason(extractNfcCardTokenFromTag({ ndefMessage: [uriRecord(`${NFC_V1_PREFIX}not-a-token`)] })),
  "invalid_token",
  "NFC-07",
);

async function runNfcCases() {
{
  const hw = fakeHardware({
    async isSupported() {
      hw.calls.push("isSupported");
      return false;
    },
  });
  const probe = await probeNfc(hw);
  assert.equal(probe.status, "unsupported", "NFC-01");
  const scan = await scanNfcCardToken(hw);
  assert.equal(scan.ok, false);
  if (!scan.ok) assert.equal(scan.reason, "unsupported");
  assert.equal(hw.calls.includes("requestNdef"), false);
  assert.equal(hw.calls.includes("cancel"), true);
}

{
  const hw = fakeHardware({
    async isEnabled() {
      hw.calls.push("isEnabled");
      return false;
    },
  });
  const scan = await scanNfcCardToken(hw);
  assert.equal(scan.ok, false);
  if (!scan.ok) assert.equal(scan.reason, "disabled", "NFC-02");
  assert.equal(nfcFailureMessage("disabled"), "NFC désactivé sur cet appareil.");
  assert.equal(hw.calls.includes("requestNdef"), false);
}

{
  const hw = fakeHardware({ tag: { ndefMessage: [uriRecord(VALID)] } });
  const scan = await scanNfcCardToken(hw);
  assert.deepEqual(scan, { ok: true, token: "synthetic.token" }, "NFC-03");
  assert.equal(hw.calls.includes("requestNdef"), true);
  assert.equal(hw.calls.at(-1), "cancel");
}

{
  const holder: VolatileCardToken = { current: null };
  assert.equal(holdCardToken(holder, "synthetic.token"), true);
  assert.equal(holdCardToken(holder, "other.token"), false, "NFC-13 no reuse");
  releaseCardToken(holder);
  assert.equal(holder.current, null);
  assert.equal(holdCardToken(holder, "other.token"), true);
}

{
  const bg = decideNfcScannerForeground({ nextAppState: "background", visible: true });
  assert.equal(bg.cancelSession, true, "NFC-14");
  assert.equal(bg.releaseToken, true);
  const fg = decideNfcScannerForeground({ nextAppState: "active", visible: true });
  assert.equal(fg.cancelSession, false);
}

{
  let resolveCalled = 0;
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: { generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" },
    selectedClass: validClass,
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-08",
    financeEnabled: false,
    isOffline: () => true,
    currentScope: () => ({ generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" }),
    resolveCard: async () => {
      resolveCalled += 1;
      return {};
    },
    recordAttendance: async () => ({}),
    createIdempotencyKey: () => "idem-1",
  });
  assert.equal(outcome.kind, "offline", "NFC-10");
  assert.equal(resolveCalled, 0);
}

{
  const author = isAttendanceAuthorReady({ status: "teacher_session" });
  assert.equal(author.ok, true);
  assert.equal("teacherId" in author && author.ok ? author.teacherId : undefined, undefined, "NFC-11");
}

{
  let recorded = 0;
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: { generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" },
    selectedClass: validClass,
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-08",
    financeEnabled: false,
    isOffline: () => false,
    currentScope: () => ({ generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" }),
    resolveCard: async () => ({
      student: { id: "stu-1", firstName: "Ada", lastName: "Lovelace", studentCode: "EL1" },
      class: { id: "other", classCode: "6B", className: "6B" },
    }),
    recordAttendance: async () => {
      recorded += 1;
      return {};
    },
    createIdempotencyKey: () => "idem-2",
  });
  assert.equal(outcome.kind, "class_mismatch", "NFC-12");
  assert.equal(recorded, 0);
}

{
  let financeCalls = 0;
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: { generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" },
    selectedClass: validClass,
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-08",
    financeEnabled: true,
    isOffline: () => false,
    currentScope: () => ({ generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" }),
    resolveCard: async () => ({
      student: { id: "stu-1", firstName: "Ada", lastName: "Lovelace", studentCode: "EL1" },
      class: { id: "cls-1", classCode: "5A", className: "5A" },
    }),
    recordAttendance: async (_token, attendance) => {
      assert.equal("teacherId" in attendance, false, "NFC-11 no client teacherId");
      return {
        student: { id: "stu-1", firstName: "Ada", lastName: "Lovelace", studentCode: "EL1" },
        class: { id: "cls-1", classCode: "5A", className: "5A" },
      };
    },
    readFinance: async () => {
      financeCalls += 1;
      return { finance: { code: "OVERDUE", label: "Échéance impayée" } };
    },
    createIdempotencyKey: () => "idem-3",
  });
  assert.equal(outcome.kind, "success");
  if (outcome.kind === "success") {
    assert.equal(outcome.view.attendanceRecorded, true);
    assert.equal(outcome.view.financeLabel, "Échéance impayée", "NFC-15");
  }
  assert.equal(financeCalls, 1);
}

{
  const started = { generation: 1, resourceScopeKey: "a", schoolCode: "CD", classId: "cls-1", classCode: "5A" };
  const outcome = await runStudentCardScanFlow({
    cardToken: "synthetic.token",
    scope: started,
    selectedClass: validClass,
    author: { status: "teacher_session" },
    attendanceDate: "2026-10-08",
    financeEnabled: false,
    isOffline: () => false,
    currentScope: () => ({ ...started, generation: 2 }),
    resolveCard: async () => ({
      student: { id: "stu-1", firstName: "Ada", lastName: "Lovelace" },
      class: { id: "cls-1", classCode: "5A" },
    }),
    recordAttendance: async () => ({}),
    createIdempotencyKey: () => "idem-4",
  });
  assert.equal(outcome.kind, "stale", "NFC-18");
}
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const nfcLib = read("lib/studentCardNfc.ts");
const native = read("lib/studentCardNfcNative.ts");
const modal = read("components/StudentCardNfcScannerModal.tsx");
const qrModal = read("components/StudentCardQrScannerModal.tsx");
const attendance = read("screens/TeacherAttendanceScreen.tsx");
const api = read("services/studentCardScanApi.ts");
const scan = read("lib/studentCardScan.ts");

assert.match(native, /react-native-nfc-manager/);
assert.match(native, /NfcTech\.Ndef/);
assert.doesNotMatch(native, /IsoDep|Felica|HCE|NfcTech\.NfcA/);
assert.doesNotMatch(nfcLib, /react-native-nfc-manager/);
assert.match(modal, /runStudentCardScanFlow/);
assert.match(modal, /scanNfcCardToken/);
assert.match(modal, /releaseNfcSession/);
assert.match(modal, /decideNfcScannerForeground/);
assert.match(modal, /onFallbackQr/);
assert.match(modal, /holdCardToken/);
assert.match(modal, /releaseCardToken/);
assert.doesNotMatch(modal, /console\.(log|info|debug|warn)/);
assert.doesNotMatch(modal, /safeLogger/);
assert.doesNotMatch(modal, /AsyncStorage|SecureStore|SQLite|submitProtectedMutation|OUTBOX/);
assert.doesNotMatch(modal, /NfcTech\.IsoDep|systemCodes|selectIdentifiers/);
assert.doesNotMatch(qrModal, /react-native-nfc-manager|createReactNativeNfcAdapter/);
assert.match(attendance, /StudentCardNfcScannerModal/);
assert.match(attendance, /isStudentCardNfcScannerVisible/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceScanNfc/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceScanQr/);
assert.doesNotMatch(attendance, /getSchoolSettings\(/);
assert.match(api, /studentCardNfcEnabled/);
assert.match(scan, /studentCardNfcEnabled/);
assert.doesNotMatch(nfcLib + native + modal, /authenticat|allowlist uid|login by uid/i);
assert.doesNotMatch(modal, /JSON\.stringify\(tag/);

void runNfcCases()
  .then(() => {
    console.log("studentCardNfc.test: SUCCESS");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
