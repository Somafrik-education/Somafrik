"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../..");
const CANONICAL =
  "Somafrik utilise l’appareil photo pour prendre la photo du compte et scanner les cartes élève par QR code.";

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function main() {
  const appJson = JSON.parse(read("Mobile/app.json"));
  const plugins = appJson.expo.plugins;
  const imagePicker = plugins.find((item) => Array.isArray(item) && item[0] === "expo-image-picker");
  const camera = plugins.find((item) => Array.isArray(item) && item[0] === "expo-camera");
  assert.ok(imagePicker, "plugin expo-image-picker");
  assert.ok(camera, "plugin expo-camera");
  assert.equal(imagePicker[1].cameraPermission, CANONICAL);
  assert.equal(camera[1].cameraPermission, CANONICAL);
  assert.equal(imagePicker[1].microphonePermission, false);
  assert.equal(camera[1].microphonePermission, false);
  assert.equal(camera[1].recordAudioAndroid, false);
  assert.deepEqual(appJson.expo.android.permissions, ["CAMERA"]);

  const pkg = JSON.parse(read("Mobile/package.json"));
  assert.match(String(pkg.dependencies["expo-camera"] || ""), /~17\.0\.10|17\.0\.10/);
  assert.ok(!pkg.dependencies["react-native-vision-camera"]);
  assert.ok(!pkg.dependencies["react-native-nfc-manager"]);
  assert.ok(!pkg.dependencies["expo-nfc"]);
  assert.ok(!pkg.dependencies["expo-barcode-scanner"]);

  const modal = read("Mobile/src/components/StudentCardQrScannerModal.tsx");
  const attendance = read("Mobile/src/screens/TeacherAttendanceScreen.tsx");
  const api = read("Mobile/src/services/studentCardScanApi.ts");
  const policy = read("Mobile/src/lib/studentCardScan.ts");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const outbox = read("Mobile/src/lib/outbox.ts");

  assert.doesNotMatch(navigator, /StudentCardScan/);
  assert.match(modal, /barcodeTypes: \["qr"\]/);
  assert.match(modal, /useCameraPermissions/);
  assert.match(modal, /Linking\.openSettings/);
  assert.doesNotMatch(modal, /Linking\.openURL/);
  assert.doesNotMatch(modal, /console\.log\(/);
  assert.doesNotMatch(modal, /safeLogger/);
  assert.doesNotMatch(modal, /submitProtectedMutation|OUTBOX_ALLOWED_DOMAINS|AsyncStorage|SecureStore|SQLite/);
  assert.match(api, /from "\.\/httpClient"/);
  assert.match(api, /httpRequest<StudentCardScanResponse>\("\/student-cards\/scan"/);
  assert.match(api, /export function resolveStudentCard/);
  assert.match(api, /export function recordStudentCardAttendance/);
  assert.match(api, /export function readStudentCardFinance/);
  assert.doesNotMatch(api, /attendance[\s\S]{0,120}finance:\s*true/);
  assert.match(policy, /isStudentCardAttendanceScanEnabled/);
  assert.match(policy, /cardBelongsToSelectedClass/);
  assert.match(policy, /runStudentCardScanFlow/);
  assert.match(attendance, /Tout présent/);
  assert.match(attendance, /Enregistrer l'appel/);
  assert.match(attendance, /ATTENDANCE_ACTIONS/);
  assert.match(attendance, /StudentCardQrScannerModal/);
  assert.match(attendance, /isStudentCardAttendanceScanEnabled/);
  assert.doesNotMatch(attendance, /CameraView/);
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS = \["messages", "presences", "notes"\]/);
  assert.doesNotMatch(outbox, /student-cards\/scan/);

  const inventory = read("docs/mobile/PLAY-STORE-DATA-INVENTORY.md");
  assert.match(inventory, /Identifiant carte élève \/ QR/);
  assert.match(inventory, /flux caméra/i);
  assert.match(inventory, /pas de NFC dans ce lot/i);

  const readiness = read("docs/mobile/RELEASE-READINESS.md");
  assert.match(readiness, /expo-camera/);
  assert.match(readiness, /~17\.0\.10|17\.0\.10/);
  assert.match(readiness, /recordAudioAndroid: false/);
  assert.match(readiness, /scanner les cartes élève par QR code/);
  assert.match(readiness, /online-only|QR online-only/);
  assert.match(readiness, /App Privacy/);

  const gate = read("docs/audits/GATE-QR-STORES-camera-qr.md");
  assert.match(gate, /\*\*Statut de ce dossier : CLOSED\.\*\*/);
  assert.match(gate, /#887/);
  assert.match(gate, /26e42c4c7a0e4636072ab328bba6cd0c42f76596/);

  const audit = read("docs/audits/AUDIT-CARTE-01-eleve-presence-nfc-qr-impayes.md");
  assert.match(audit, /GATE-QR-STORES CLOSED|#887/);
  assert.match(audit, /CARTE-PR7 OPEN \/ DRAFT/);
  assert.match(audit, /GATE-NFC-STORES/);
  assert.doesNotMatch(audit, /PR7 ouverte/);

  console.log("verify-student-card-qr: SUCCESS");
}

main();
