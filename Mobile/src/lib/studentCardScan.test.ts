import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANONICAL_CAMERA_PERMISSION,
  extractQrCapability,
  holdCardToken,
  isQrBarcodeType,
  isStudentCardQrScanEnabled,
  isStudentCardScanAttendanceEnabled,
  isStudentCardScanFinanceEnabled,
  isoAttendanceDate,
  releaseCardToken,
  studentCardScanErrorMessage,
  type VolatileCardToken,
} from "./studentCardScan";

assert.equal(
  CANONICAL_CAMERA_PERMISSION,
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.",
);

assert.equal(isStudentCardQrScanEnabled(null), false);
assert.equal(isStudentCardQrScanEnabled({ studentCardEnabled: true }), false);
assert.equal(
  isStudentCardQrScanEnabled({ studentCardEnabled: true, studentCardQrEnabled: true }),
  true,
);
assert.equal(
  isStudentCardScanAttendanceEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardAttendanceEnabled: false,
  }),
  false,
);
assert.equal(
  isStudentCardScanAttendanceEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardAttendanceEnabled: true,
  }),
  true,
);
assert.equal(
  isStudentCardScanFinanceEnabled({
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardFinanceCheckEnabled: true,
  }),
  true,
);

assert.equal(extractQrCapability("  abc.def  "), "abc.def");
assert.equal(isQrBarcodeType("qr"), true);
assert.equal(isQrBarcodeType("org.iso.QRCode"), true);
assert.equal(isQrBarcodeType("ean13"), false);

const holder: VolatileCardToken = { current: null };
assert.equal(holdCardToken(holder, "pub.secret"), true);
assert.equal(holder.current, "pub.secret");
assert.equal(holdCardToken(holder, "other.token"), false, "rafale bloquée");
releaseCardToken(holder);
assert.equal(holder.current, null);

assert.equal(studentCardScanErrorMessage({ code: "STUDENT_CARD_DISABLED" }), "La carte élève est désactivée pour cet établissement.");
assert.match(isoAttendanceDate(new Date("2026-10-06T12:00:00")), /^\d{4}-\d{2}-\d{2}$/);

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function read(rel: string) {
  return fs.readFileSync(path.join(root, rel), "utf8");
}

const scanScreen = read("screens/StudentCardScanScreen.tsx");
const attendance = read("screens/TeacherAttendanceScreen.tsx");
const api = read("services/studentCardsApi.ts");
const appJson = read("../app.json");
const inventory = fs.readFileSync(
  path.join(root, "../../docs/mobile/PLAY-STORE-DATA-INVENTORY.md"),
  "utf8",
);

assert.match(scanScreen, /CameraView/);
assert.match(scanScreen, /barcodeTypes:\s*\["qr"\]/);
assert.match(scanScreen, /useCameraPermissions/);
assert.match(scanScreen, /isOfflineContext/);
assert.match(scanScreen, /Linking\.openSettings/);
assert.doesNotMatch(scanScreen, /Linking\.openURL/);
assert.doesNotMatch(scanScreen, /scanFromURLAsync/);
assert.doesNotMatch(scanScreen, /console\.log/);
assert.doesNotMatch(scanScreen, /safeLogger/);
assert.doesNotMatch(scanScreen, /AsyncStorage|SecureStore|SQLite|submitProtectedMutation|persistOutbox/);
assert.doesNotMatch(scanScreen, /react-native-nfc-manager|expo-nfc|NDEFReader/);
assert.match(scanScreen, /releaseCardToken/);
assert.match(api, /\/student-cards\/scan/);
assert.match(api, /idempotencyKey: options\?\.idempotencyKey/);
assert.doesNotMatch(api, /console\.log/);

assert.match(attendance, /USABILITY_TEST_IDS\.attendanceSave/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceMarkAllPresent/);
assert.match(attendance, /ATTENDANCE_ACTIONS/);
assert.match(attendance, /Tout présent/);
assert.match(attendance, /Enregistrer l'appel/);
assert.match(attendance, /USABILITY_TEST_IDS\.attendanceScanQr/);
assert.doesNotMatch(attendance, /useCameraPermissions|requestCameraPermissionsAsync/);
assert.doesNotMatch(attendance, /CameraView/);

assert.match(appJson, /"expo-camera"/);
assert.match(appJson, /"recordAudioAndroid": false/);
assert.equal(
  (appJson.match(/Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code\./g) || []).length,
  2,
  "chaîne caméra duale identique sur image-picker et camera",
);
assert.match(inventory, /Identifiant carte élève \/ QR/);

console.log("studentCardScan.test.ts OK");
