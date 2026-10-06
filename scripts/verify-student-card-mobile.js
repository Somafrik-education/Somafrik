"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
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

  const scan = read("Mobile/src/screens/StudentCardScanScreen.tsx");
  const attendance = read("Mobile/src/screens/TeacherAttendanceScreen.tsx");
  const api = read("Mobile/src/services/studentCardsApi.ts");
  const navigator = read("Mobile/src/navigation/AppNavigator.tsx");
  const permissions = read("Mobile/src/domain/security/permissions.ts");
  const outbox = read("Mobile/src/lib/outbox.ts");

  assert.match(navigator, /name="StudentCardScan"/);
  assert.match(permissions, /StudentCardScan: "Présences"/);
  assert.match(permissions, /routeName === "StudentCardScan"/);
  assert.match(permissions, /canManagePresences\(session\)/);
  assert.match(scan, /barcodeTypes: \["qr"\]/);
  assert.match(scan, /useCameraPermissions/);
  assert.doesNotMatch(scan, /submitProtectedMutation|OUTBOX_ALLOWED_DOMAINS/);
  assert.doesNotMatch(api, /AsyncStorage|SecureStore|localStorage/);
  assert.match(attendance, /Tout présent/);
  assert.match(attendance, /Enregistrer l'appel/);
  assert.match(outbox, /OUTBOX_ALLOWED_DOMAINS = \["messages", "presences", "notes"\]/);
  assert.doesNotMatch(outbox, /student-cards\/scan/);

  const inventory = read("docs/mobile/PLAY-STORE-DATA-INVENTORY.md");
  assert.match(inventory, /Identifiant carte élève \/ QR/);
  assert.match(inventory, /Caméra \(détection locale du QR\)/);
  assert.match(inventory, /pas de NFC dans ce lot/i);

  const readiness = read("docs/mobile/RELEASE-READINESS.md");
  assert.match(readiness, /expo-camera/);
  assert.match(readiness, /recordAudioAndroid: false/);
  assert.match(readiness, /scanner les cartes élève par QR code/);
  assert.match(readiness, /App Privacy/);

  const gate = read("docs/audits/GATE-QR-STORES-camera-qr.md");
  assert.match(gate, /\*\*Statut de ce dossier : CLOSED\.\*\*/);
  assert.match(gate, /#887/);
  const audit = read("docs/audits/AUDIT-CARTE-01-eleve-presence-nfc-qr-impayes.md");
  assert.match(audit, /GATE-QR-STORES \| \*\*CLOS\*\*/);
  assert.doesNotMatch(audit, /PR7 ouverte/);
  assert.doesNotMatch(audit, /GATE-QR-STORES CLOSED/);

  console.log("verify-student-card-mobile: SUCCESS");
}

main();
