/**
 * PRES-LOCAL-NAV-01 — Présences locales : une classe ouverte démarre l'appel NFC/QR directement,
 * sans seconde sélection de classe, pour Directeur, Secrétaire et Enseignant.
 *   npx --yes tsx --test Mobile/src/lib/rollCallDirectStart.test.ts
 *
 * Aucune autorisation nouvelle : la classe doit figurer dans la liste serveur du compte (même
 * contrat que le sélecteur). Le serveur revérifie au pack et à la synchronisation.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { ROLL_CALL_PERMISSION, rollCallActor } from "./studentCardRollCallRoles";
import { resolveRollCallLauncher } from "./rollCallLauncher";
import {
  ROLL_CALL_CLASS_LIST_TTL_MS,
  canonicalRollCallClassId,
  isAuthoritativeRollCallListRefusal,
  loadRollCallClasses,
  matchDirectRollCallTarget,
  resetRollCallClassListsForTests,
} from "./rollCallDirectStart";

const SETTINGS = { studentCardEnabled: true, studentCardQrEnabled: true, studentCardNfcEnabled: true, studentCardAttendanceEnabled: true, studentCardOfflineRollCallEnabled: true };
const WRITE = ["Présences:READ", "Présences:CREATE", "Présences:UPDATE"];
const session = (roleKeys: string[], permissions: string[]) => ({ user: { roleKeys, permissions }, permissions });
const CLASS_A = "3f2b8c1e-7d4a-4b9e-9c1a-2e5f6a7b8c9d";
const CLASS_B = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const option = (classId: string, className: string) => ({ classId, classCode: null, className, enrolled: 30 });

const ROLES: Array<[string, string[], string[]]> = [
  ["Directeur", ["SCHOOL_ADMIN"], [ROLL_CALL_PERMISSION]],
  ["Secrétaire", ["SECRETARY"], [ROLL_CALL_PERMISSION, ...WRITE]],
  ["Enseignant", ["TEACHER"], [ROLL_CALL_PERMISSION, ...WRITE]],
];

test("Directeur, Secrétaire, Enseignant : classe ouverte autorisée → appel direct, même classId que le sélecteur", async () => {
  for (const [label, keys, permissions] of ROLES) {
    resetRollCallClassListsForTests();
    const sess = session(keys, permissions);
    const launcher = resolveRollCallLauncher({ session: sess, actor: rollCallActor(sess), settings: SETTINGS as never, platformOs: "android" });
    assert.equal(launcher.canStartRollCall, true, `${label} : bouton disponible (RBAC inchangé)`);
    // Identifiant local en majuscules : normalisé comme la liste serveur → reprise du même brouillon.
    const opened = { classId: CLASS_A.toUpperCase(), classCode: "6A", className: "6e A" };
    const list = await loadRollCallClasses(`env|school|${label}`, async () => ({ classes: [option(CLASS_A, "6e A")] }));
    assert.deepEqual(matchDirectRollCallTarget(opened, list.classes), { classId: CLASS_A, className: "6e A" }, label);
  }
});

test("classe non proposée par le serveur au compte → sélecteur (aucun contournement RBAC)", async () => {
  for (const [label] of ROLES) {
    resetRollCallClassListsForTests();
    const list = await loadRollCallClasses(`env|school|${label}`, async () => ({ classes: [option(CLASS_B, "5e B")] }));
    assert.equal(matchDirectRollCallTarget({ classId: CLASS_A, className: "6e A" }, list.classes), null, label);
  }
  assert.equal(matchDirectRollCallTarget({ classId: CLASS_A, className: "6e A" }, []), null, "liste vide");
  assert.equal(matchDirectRollCallTarget(null, [option(CLASS_A, "6e A")]), null, "aucune classe ouverte");
});

test("identifiant non canonique → jamais d'ouverture directe", () => {
  assert.equal(canonicalRollCallClassId("CLS-6A"), "");
  assert.equal(canonicalRollCallClassId(""), "");
  assert.equal(canonicalRollCallClassId(` ${CLASS_A.toUpperCase()} `), CLASS_A);
  assert.equal(matchDirectRollCallTarget({ classId: "6A", className: "6e A" }, [option(CLASS_A, "6e A")]), null);
});

test("hors connexion : dernière liste du MÊME compte uniquement ; sinon échec → sélecteur", async () => {
  resetRollCallClassListsForTests();
  await loadRollCallClasses("env|school|directeur", async () => ({ classes: [option(CLASS_A, "6e A")] }));
  const offline = async () => {
    throw new Error("network");
  };
  const cached = await loadRollCallClasses("env|school|directeur", offline);
  assert.equal(cached.cached, true);
  assert.deepEqual(matchDirectRollCallTarget({ classId: CLASS_A, className: "6e A" }, cached.classes)?.classId, CLASS_A);
  await assert.rejects(loadRollCallClasses("env|school|secretaire", offline), "aucune liste partagée entre comptes");
  await assert.rejects(loadRollCallClasses("", offline), "portée inconnue : aucune copie");
});

test("revue CTO — refus serveur (4xx, droits retirés) : copie du compte purgée, jamais réutilisée", async () => {
  for (const status of [401, 403, 404]) {
    resetRollCallClassListsForTests();
    const scope = `env|school|refus-${status}`;
    await loadRollCallClasses(scope, async () => ({ classes: [option(CLASS_A, "6e A")] }));
    const refused = Object.assign(new Error("refus"), { status });
    assert.equal(isAuthoritativeRollCallListRefusal(refused), true);
    await assert.rejects(loadRollCallClasses(scope, async () => { throw refused; }), `${status} : pas de repli`);
    // Puis coupure réseau : la copie d'avant le refus n'existe plus.
    await assert.rejects(loadRollCallClasses(scope, async () => { throw new Error("network"); }), `${status} : copie purgée`);
  }
});

test("revue CTO — serveur injoignable (réseau 0, délai, 5xx) : copie récente seulement, expiration explicite", async () => {
  for (const unreachable of [
    Object.assign(new Error("offline"), { status: 0 }),
    Object.assign(new Error("timeout"), { status: undefined }),
    Object.assign(new Error("5xx"), { status: 503 }),
  ]) {
    assert.equal(isAuthoritativeRollCallListRefusal(unreachable), false);
    resetRollCallClassListsForTests();
    let clock = 1_000_000;
    const now = () => clock;
    await loadRollCallClasses("env|school|a", async () => ({ classes: [option(CLASS_A, "6e A")] }), now);
    clock += ROLL_CALL_CLASS_LIST_TTL_MS;
    assert.equal((await loadRollCallClasses("env|school|a", async () => { throw unreachable; }, now)).cached, true, "à la limite");
    clock += 1;
    await assert.rejects(loadRollCallClasses("env|school|a", async () => { throw unreachable; }, now), "expirée");
    clock -= 1;
    await assert.rejects(loadRollCallClasses("env|school|a", async () => { throw unreachable; }, now), "purgée après expiration");
  }
  // Horloge reculée : copie non datable, jamais utilisée.
  resetRollCallClassListsForTests();
  let clock = 5_000_000;
  await loadRollCallClasses("env|school|b", async () => ({ classes: [option(CLASS_A, "6e A")] }), () => clock);
  clock -= 1;
  await assert.rejects(loadRollCallClasses("env|school|b", async () => { throw new Error("network"); }, () => clock));
});

test("revue CTO — droits retirés pour une classe : la nouvelle liste serveur remplace la copie", async () => {
  resetRollCallClassListsForTests();
  await loadRollCallClasses("env|school|c", async () => ({ classes: [option(CLASS_A, "6e A")] }));
  await loadRollCallClasses("env|school|c", async () => ({ classes: [option(CLASS_B, "5e B")] }));
  const offline = await loadRollCallClasses("env|school|c", async () => { throw new Error("network"); });
  assert.equal(matchDirectRollCallTarget({ classId: CLASS_A }, offline.classes), null);
});

test("écran Présences : bouton relié au hook de démarrage ; sélecteur partageant la même liste", () => {
  const screen = readFileSync(path.join(__dirname, "../screens/TeacherAttendanceScreen.tsx"), "utf8");
  const picker = readFileSync(path.join(__dirname, "../components/RollCallClassPickerModal.tsx"), "utf8");
  assert.match(screen, /rollCallButton\("attendance-offline-roll-call", OFFLINE_ROLL_CALL_COPY\.start, startLocalRollCall\)/);
  assert.match(screen, /const startLocalRollCall = useLocalRollCallStart\(\{\s*\n\s*scopeKey: rollCallPickerScope,\s*\n\s*selectedClass,\s*\n\s*fetchClasses: listOfflineRollCallClasses,\s*\n\s*onOpenPicker: \(\) => setRollCallPickerOpen\(true\),/);
  // Même fenêtre d'appel local (même moteur, même brouillon SQLite), toujours gardée par le droit.
  assert.equal((screen.match(/setRollCallTarget\(\{ \.\.\.target, date: isoAttendanceDate\(\) \}\)/g) ?? []).length, 2);
  assert.match(screen, /\{rollCallTarget && launcher\.canStartRollCall \? \(/);
  assert.match(screen, /\{launcher\.canStartRollCall\s*\n\s*\? rollCallButton\("attendance-offline-roll-call"/);
  // Le sélecteur partage la même mémoire de liste par compte (même expiration, même purge).
  assert.match(picker, /loadRollCallClasses\(scopeKey, listOfflineRollCallClasses\)/);
  assert.doesNotMatch(picker, /new Map</);
});
