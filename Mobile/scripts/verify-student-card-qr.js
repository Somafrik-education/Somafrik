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
  assert.equal(pkg.dependencies["react-native-nfc-manager"], "4.0.0-beta.10");
  assert.ok(!pkg.dependencies["expo-nfc"]);
  assert.ok(!pkg.dependencies["expo-barcode-scanner"]);

  const modal = read("Mobile/src/components/StudentCardQrScannerModal.tsx");
  const nfcModal = read("Mobile/src/components/StudentCardNfcScannerModal.tsx");
  const nfcNative = read("Mobile/src/lib/studentCardNfcNative.ts");
  const nfcPolicy = read("Mobile/src/lib/studentCardNfc.ts");
  const attendance = read("Mobile/src/screens/TeacherAttendanceScreen.tsx");
  const api = read("Mobile/src/services/studentCardScanApi.ts");
  const policy = read("Mobile/src/lib/studentCardScan.ts");
  const establishment = read("Mobile/src/lib/establishment.ts");
  const authorIdentity = read("Mobile/src/lib/attendanceClassIdentity.ts");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const permissions = read("Mobile/src/domain/security/permissions.ts");
  const outbox = read("Mobile/src/lib/outbox.ts");

  assert.equal(fs.existsSync(path.join(ROOT, "Mobile/src/screens/StudentCardScanScreen.tsx")), false);
  assert.doesNotMatch(navigator, /StudentCardScan/);
  assert.doesNotMatch(navigator, /Stack\.Screen name="StudentCardScan"/);
  assert.doesNotMatch(permissions, /StudentCardScan/);
  assert.doesNotMatch(permissions, /role === ["']student["']/);
  assert.match(modal, /barcodeTypes: \["qr"\]/);
  assert.match(modal, /useCameraPermissions/);
  assert.match(modal, /Linking\.openSettings/);
  assert.match(modal, /scanScopeKey/);
  assert.match(modal, /hasValidSelectedClass/);
  assert.match(modal, /decideCameraPermissionPrompt/);
  assert.match(modal, /decideQrScannerForeground/);
  assert.match(modal, /isQrScannerCameraLive/);
  assert.match(modal, /visibleRef/);
  assert.doesNotMatch(modal, /AppState\.addEventListener\([\s\S]{0,800}onClose\(/);
  assert.doesNotMatch(modal, /Linking\.openURL/);
  assert.doesNotMatch(modal, /console\.log\(/);
  assert.doesNotMatch(modal, /safeLogger/);
  assert.doesNotMatch(modal, /submitProtectedMutation|OUTBOX_ALLOWED_DOMAINS|AsyncStorage|SecureStore|SQLite/);
  assert.doesNotMatch(modal, /student-card-scan-late|setAttendanceStatus\(["']late["']\)|status:\s*["']late["']/);
  assert.doesNotMatch(modal, /useState\([^)]*cardToken|setToken\(|navigation\.navigate/);
  assert.match(api, /from "\.\/httpClient"/);
  assert.match(api, /httpRequest<StudentCardScanResponse>\("\/student-cards\/scan"/);
  assert.match(api, /httpRequest<StudentCardCapabilities>\("\/student-cards\/capabilities"/);
  assert.match(api, /export function getStudentCardCapabilities/);
  assert.doesNotMatch(api, /schoolCode/);
  assert.match(api, /export function resolveStudentCard/);
  assert.match(api, /export function recordStudentCardAttendance/);
  assert.match(api, /export function readStudentCardFinance/);
  assert.match(api, /status: "present"/);
  assert.doesNotMatch(api, /status: "late"/);
  assert.doesNotMatch(api, /attendance[\s\S]{0,120}finance:\s*true/);
  assert.match(policy, /isStudentCardAttendanceScanEnabled/);
  assert.match(policy, /cardBelongsToSelectedClass/);
  assert.match(policy, /hasValidSelectedClass/);
  assert.match(policy, /runStudentCardScanFlow/);
  assert.match(policy, /decideCameraPermissionPrompt/);
  assert.match(policy, /decideQrScannerForeground/);
  assert.match(policy, /attendanceClassScopeKey/);
  assert.match(policy, /reduceQrScannerUi/);
  assert.match(policy, /status: "present"/);
  assert.match(attendance, /Tout présent/);
  assert.match(attendance, /Enregistrer l'appel/);
  assert.match(attendance, /ATTENDANCE_ACTIONS/);
  assert.match(attendance, /StudentCardQrScannerModal/);
  assert.match(attendance, /isStudentCardQrScannerVisible/);
  assert.match(attendance, /getStudentCardCapabilities/);
  assert.match(attendance, /sanitizeStudentCardCapabilities/);
  assert.match(attendance, /attendanceClassScopeKey/);
  assert.match(attendance, /selectedClassScopeKey/);
  assert.doesNotMatch(attendance, /setScannerOpen\(false\);\s*\}, \[selectedClass\]\)/);
  assert.doesNotMatch(attendance, /getSchoolSettings\(/);
  assert.doesNotMatch(attendance, /Paramètres Établissement:READ/);
  assert.match(policy, /hasValidSelectedClass/);
  assert.match(attendance, /selectedClass=\{selectedClass\}/);
  assert.match(establishment, /resolveCanonicalRoleIdentity/);
  assert.match(establishment, /canonicalizeRoleKey/);
  assert.match(establishment, /hasAuthoritativeRoleKeys/);
  assert.doesNotMatch(establishment, /isTeacherUserRole/);
  assert.doesNotMatch(establishment, /includes\(["']prof["']\)/);
  assert.match(authorIdentity, /isTeacherSession/);
  assert.match(authorIdentity, /teacher_session/);
  assert.match(authorIdentity, /ne pas forger teacherId/);
  assert.doesNotMatch(attendance, /CameraView/);
  assert.doesNotMatch(attendance, /navigate\(["']StudentCardScan["']/);
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS = \["messages", "presences", "notes"\]/);
  assert.doesNotMatch(outbox, /student-cards\/scan/);

  for (const source of [modal, nfcModal, nfcPolicy, nfcNative, api, attendance, policy]) {
    assert.doesNotMatch(source, /console\.(log|info|debug|warn)\([^)]*(scanningResult\.data|cardToken|tokenRef|ndefMessage)/);
    assert.doesNotMatch(source, /safeLogger\([^)]*(scanningResult\.data|cardToken|tokenRef|ndefMessage)/);
    assert.doesNotMatch(source, /AsyncStorage|SecureStore|SQLite/);
  }

  assert.match(nfcModal, /runStudentCardScanFlow/);
  assert.match(nfcModal, /scanNfcCardToken/);
  assert.match(nfcModal, /qrFallbackEnabled/);
  assert.match(nfcModal, /shouldShowNfcQrFallback/);
  assert.match(attendance, /decideOpenQrFromNfcFallback/);
  assert.match(attendance, /qrFallbackEnabled=\{canOpenQrScanner\}/);
  assert.match(nfcNative, /NfcTech\.Ndef/);
  assert.match(nfcPolicy, /somafrik:card:/);
  assert.doesNotMatch(nfcPolicy, /react-native-nfc-manager/);
  assert.doesNotMatch(modal, /react-native-nfc-manager/);
  assert.match(attendance, /StudentCardNfcScannerModal/);
  assert.match(attendance, /isStudentCardNfcScannerVisible/);
  const nfcPlugin = appJson.expo.plugins.find((item) => Array.isArray(item) && item[0] === "react-native-nfc-manager");
  assert.ok(nfcPlugin, "plugin react-native-nfc-manager");
  assert.equal(
    nfcPlugin[1].nfcPermission,
    "Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.",
  );
  assert.equal(nfcPlugin[1].includeNdefEntitlement, true);
  assert.equal(nfcPlugin[1].selectIdentifiers, undefined);
  assert.equal(nfcPlugin[1].systemCodes, undefined);

  const inventory = read("docs/mobile/PLAY-STORE-DATA-INVENTORY.md");
  assert.match(inventory, /Identifiant carte élève \/ QR/);
  assert.match(inventory, /flux caméra/i);
  assert.match(inventory, /QR ou NFC/i);
  assert.match(inventory, /Identification scolaire/i);
  assert.doesNotMatch(inventory, /pas de NFC dans ce lot/i);

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
