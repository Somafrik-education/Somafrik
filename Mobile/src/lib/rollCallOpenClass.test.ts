/**
 * APPEL-NAV-01 — Présences locales (appel NFC/QR) : une seule sélection de classe.
 *   npx --yes tsx --test Mobile/src/lib/rollCallOpenClass.test.ts
 *
 * Parcours attendu (Directeur, Secrétaire, Enseignant) : Présences → classe → « Démarrer l'appel
 * NFC/QR » ouvre directement l'appel de CETTE classe, sans repasser par le sélecteur, à condition
 * que la classe figure dans la liste serveur du compte (même périmètre que le sélecteur).
 * Revue CTO #1161 : chaque réponse est liée à l'identité environnement | établissement | compte ;
 * une réponse tardive d'une ancienne identité n'ouvre rien et ne remplit pas le cache.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  createDirectRollCallOpener,
  createScopedRollCallClassLoader,
  findAuthorizedRollCallClass,
  isStaleRollCallScope,
  type RollCallClassListItem,
  type RollCallClassRef,
} from "./rollCallOpenClass";

const screen = readFileSync(path.join(__dirname, "../screens/TeacherAttendanceScreen.tsx"), "utf8");
const picker = readFileSync(path.join(__dirname, "../components/RollCallClassPickerModal.tsx"), "utf8");

// Clés d'identité environnement | établissement | compte.
const DIRECTOR_A = "env|school-a|director-a";
const SECRETARY_A = "env|school-a|secretary-a";
const TEACHER_A = "env|school-a|teacher-a";
const DIRECTOR_B = "env|school-b|director-b";

// Listes renvoyées par GET …/roll-call/offline/v1/classes selon l'autorité du compte.
const SCHOOL_A = [
  { classId: "c-6a", className: "6e A" },
  { classId: "c-6b", className: "6e B" },
  { classId: "c-5a", className: "5e A" },
];
const TEACHER_A_CLASSES = [SCHOOL_A[0]];
// École B : MÊME identifiant de classe que l'école A (cas exigé par la revue), autre libellé.
const SCHOOL_B = [{ classId: "c-6a", className: "6e A (école B)" }];

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Serveur simulé : chaque appel renvoie une promesse que le test résout quand il veut. */
function fakeServer() {
  const calls: Deferred<{ classes: RollCallClassListItem[] }>[] = [];
  return {
    calls,
    fetch: () => {
      const call = deferred<{ classes: RollCallClassListItem[] }>();
      calls.push(call);
      return call.promise;
    },
  };
}

/** Écran simulé : identité, classe ouverte, appel affiché, ouvertures et sélecteurs. */
function fakeScreen(initial: { scope: string; classId: string }) {
  const server = fakeServer();
  const loader = createScopedRollCallClassLoader(server.fetch);
  const live = { scope: initial.scope, classId: initial.classId, open: false };
  const opened: RollCallClassRef[] = [];
  let pickers = 0;
  const opener = createDirectRollCallOpener({
    load: loader.load,
    currentScope: () => live.scope,
    currentClassId: () => live.classId,
    isRollCallOpen: () => live.open,
    onOpen: (target) => {
      opened.push(target);
      live.open = true;
    },
    onPicker: () => {
      pickers += 1;
    },
  });
  return { server, loader, live, opened, opener, pickers: () => pickers };
}

// ── Correspondance pure ──────────────────────────────────────────────────────────

test("correspondance : identifiant serveur, casse/espaces sans effet, aucune correspondance partielle", () => {
  assert.deepEqual(findAuthorizedRollCallClass(SCHOOL_A, " C-5A "), { classId: "c-5a", className: "5e A" });
  assert.equal(findAuthorizedRollCallClass(SCHOOL_A, "c-6"), null);
  assert.equal(findAuthorizedRollCallClass([], "c-6a"), null);
  for (const missing of ["", "   ", null, undefined]) assert.equal(findAuthorizedRollCallClass(SCHOOL_A, missing), null);
});

// ── Parcours par rôle ────────────────────────────────────────────────────────────

for (const [role, scope] of [["Directeur", DIRECTOR_A], ["Secrétaire", SECRETARY_A]] as const) {
  test(`${role} (périmètre établissement) : classe ouverte → appel direct, aucun sélecteur`, async () => {
    const s = fakeScreen({ scope, classId: "c-6b" });
    const done = s.opener.start();
    s.server.calls[0].resolve({ classes: SCHOOL_A });
    await done;
    assert.deepEqual(s.opened, [{ classId: "c-6b", className: "6e B" }]);
    assert.equal(s.pickers(), 0);
  });
}

test("Enseignant : classe affectée → appel direct ; classe non affectée → sélecteur", async () => {
  const assigned = fakeScreen({ scope: TEACHER_A, classId: "c-6a" });
  const a = assigned.opener.start();
  assigned.server.calls[0].resolve({ classes: TEACHER_A_CLASSES });
  await a;
  assert.deepEqual(assigned.opened, [{ classId: "c-6a", className: "6e A" }]);

  const other = fakeScreen({ scope: TEACHER_A, classId: "c-6b" });
  const b = other.opener.start();
  other.server.calls[0].resolve({ classes: TEACHER_A_CLASSES });
  await b;
  assert.deepEqual(other.opened, []);
  assert.equal(other.pickers(), 1);
});

test("sans classe ouverte ou sans identité résolue : sélecteur, aucune requête", async () => {
  const noClass = fakeScreen({ scope: DIRECTOR_A, classId: "" });
  await noClass.opener.start();
  assert.equal(noClass.pickers(), 1);
  assert.equal(noClass.server.calls.length, 0);

  const noIdentity = fakeScreen({ scope: "", classId: "c-6a" });
  await noIdentity.opener.start();
  assert.equal(noIdentity.pickers(), 1);
  assert.equal(noIdentity.server.calls.length, 0);
});

// ── Concurrence et identité (revue CTO) ──────────────────────────────────────────

test("changement de compte/école en vol, MÊME classId : réponse ancienne rejetée, rien d'ouvert, cache intact", async () => {
  const s = fakeScreen({ scope: DIRECTOR_A, classId: "c-6a" });
  const done = s.opener.start();
  s.live.scope = DIRECTOR_B; // bascule de session ; la classe c-6a existe aussi dans l'école B
  s.server.calls[0].resolve({ classes: SCHOOL_A });
  await done;
  assert.deepEqual(s.opened, []);
  assert.equal(s.pickers(), 0, "réponse obsolète : pas même de sélecteur");
  assert.equal(s.loader.cachedFor(DIRECTOR_A), undefined, "pas de cache sous l'ancienne identité");
  assert.equal(s.loader.cachedFor(DIRECTOR_B), undefined, "ni sous la nouvelle");
});

test("échec réseau revenu après changement d'identité : ni cache de l'ancienne, ni sélecteur", async () => {
  const s = fakeScreen({ scope: DIRECTOR_A, classId: "c-6a" });
  const first = s.opener.start();
  s.server.calls[0].resolve({ classes: SCHOOL_A });
  await first; // cache A rempli
  s.live.open = false;
  s.opened.length = 0;

  const second = s.opener.start();
  s.live.scope = DIRECTOR_B;
  s.server.calls[1].reject(new Error("network"));
  await second;
  assert.deepEqual(s.opened, [], "le cache de A n'est jamais servi sous B");
  assert.equal(s.pickers(), 0);
});

test("chargeur : départ sous une clé qui n'est plus courante → refus immédiat, aucune requête", async () => {
  const server = fakeServer();
  const loader = createScopedRollCallClassLoader(server.fetch);
  await assert.rejects(loader.load(DIRECTOR_A, () => DIRECTOR_B), (error) => isStaleRollCallScope(error));
  assert.equal(server.calls.length, 0);
});

test("chargeur seul : échec réseau après changement d'identité → rejet obsolète, jamais le cache de l'ancienne", async () => {
  const server = fakeServer();
  const loader = createScopedRollCallClassLoader(server.fetch);
  let scope = DIRECTOR_A;
  const warm = loader.load(DIRECTOR_A, () => scope);
  server.calls[0].resolve({ classes: SCHOOL_A });
  await warm;
  const late = loader.load(DIRECTOR_A, () => scope);
  scope = DIRECTOR_B;
  server.calls[1].reject(new Error("network"));
  await assert.rejects(late, (error) => isStaleRollCallScope(error));
});

test("opener seul : même si le chargement réussit, un changement d'identité en vol n'ouvre rien", async () => {
  // Chargeur volontairement naïf (aucun contrôle) : la garde de l'opener doit suffire seule.
  const live = { scope: DIRECTOR_A, classId: "c-6a", open: false };
  const response = deferred<{ classes: RollCallClassListItem[] }>();
  const opened: RollCallClassRef[] = [];
  let pickers = 0;
  const opener = createDirectRollCallOpener({
    load: () => response.promise,
    currentScope: () => live.scope,
    currentClassId: () => live.classId,
    isRollCallOpen: () => live.open,
    onOpen: (target) => opened.push(target),
    onPicker: () => {
      pickers += 1;
    },
  });
  const done = opener.start();
  live.scope = DIRECTOR_B;
  response.resolve({ classes: SCHOOL_B });
  await done;
  assert.deepEqual(opened, []);
  assert.equal(pickers, 0);
});

test("chargeur : requêtes concurrentes d'une même clé — une réponse ancienne n'écrase pas la plus récente", async () => {
  const server = fakeServer();
  const loader = createScopedRollCallClassLoader(server.fetch);
  const current = () => DIRECTOR_A;
  const older = loader.load(DIRECTOR_A, current);
  const newer = loader.load(DIRECTOR_A, current);
  server.calls[1].resolve({ classes: SCHOOL_A });
  await newer;
  server.calls[0].resolve({ classes: [SCHOOL_A[0]] });
  await older;
  assert.deepEqual(loader.cachedFor(DIRECTOR_A), SCHOOL_A);
});

test("chargeur : caches séparés par identité, jamais lus depuis une autre clé", async () => {
  const server = fakeServer();
  const loader = createScopedRollCallClassLoader(server.fetch);
  const a = loader.load(DIRECTOR_A, () => DIRECTOR_A);
  server.calls[0].resolve({ classes: SCHOOL_A });
  await a;
  const b = loader.load(DIRECTOR_B, () => DIRECTOR_B);
  server.calls[1].reject(new Error("network"));
  await assert.rejects(b, /network/);
  assert.equal(loader.cachedFor(DIRECTOR_B), undefined);
  assert.equal(loader.cachedFor(""), undefined);
});

test("changement de classe en vol : rien d'ouvert pour l'ancienne classe", async () => {
  const s = fakeScreen({ scope: DIRECTOR_A, classId: "c-6a" });
  const done = s.opener.start();
  s.live.classId = "c-6b";
  s.server.calls[0].resolve({ classes: SCHOOL_A });
  await done;
  assert.deepEqual(s.opened, []);
  assert.equal(s.pickers(), 0);
});

test("double appui : une seule requête, une seule ouverture (pas de seconde session d'appel)", async () => {
  const s = fakeScreen({ scope: SECRETARY_A, classId: "c-5a" });
  const first = s.opener.start();
  const second = s.opener.start();
  assert.equal(s.server.calls.length, 1);
  s.server.calls[0].resolve({ classes: SCHOOL_A });
  await Promise.all([first, second]);
  assert.equal(s.opened.length, 1);
  // Appui alors que l'appel est déjà affiché : rien.
  await s.opener.start();
  assert.equal(s.server.calls.length, 1);
  assert.equal(s.opened.length, 1);
  assert.equal(s.opener.isLoading(), false);
});

// ── Hors connexion ───────────────────────────────────────────────────────────────

test("hors connexion avec liste connue du même compte : appel direct depuis le cache", async () => {
  const s = fakeScreen({ scope: DIRECTOR_A, classId: "c-6b" });
  const online = s.opener.start();
  s.server.calls[0].resolve({ classes: SCHOOL_A });
  await online;
  s.live.open = false; // « Fermer (garder le brouillon) »
  s.opened.length = 0;

  const offline = s.opener.start();
  s.server.calls[1].reject(new Error("network"));
  await offline;
  assert.deepEqual(s.opened, [{ classId: "c-6b", className: "6e B" }]);
  assert.equal(s.pickers(), 0);
});

test("hors connexion sans liste connue : sélecteur (erreur + Réessayer), rien d'ouvert", async () => {
  const s = fakeScreen({ scope: DIRECTOR_A, classId: "c-6a" });
  const done = s.opener.start();
  s.server.calls[0].reject(new Error("network"));
  await done;
  await flush();
  assert.deepEqual(s.opened, []);
  assert.equal(s.pickers(), 1);
});

// ── Câblage écran / sélecteur ────────────────────────────────────────────────────

test("écran : opener unique, lié à l'identité et à la classe courantes ; un seul point d'ouverture", () => {
  assert.match(screen, /rollCallButton\("attendance-offline-roll-call", OFFLINE_ROLL_CALL_COPY\.start, startOfflineRollCall\)/);
  assert.match(screen, /rollCallLiveRef\.current = \{ scope: rollCallPickerScope, classId: String\(selectedClass\?\.classId \?\? ""\), open: rollCallTarget !== null \};/);
  assert.match(screen, /createDirectRollCallOpener\(\{\s*load: loadRollCallClasses,\s*currentScope: \(\) => rollCallLiveRef\.current\.scope,\s*currentClassId: \(\) => rollCallLiveRef\.current\.classId,/);
  assert.match(screen, /onSelect=\{\(target\) => \{\s*setRollCallPickerOpen\(false\);\s*openRollCallTarget\(target\);/);
  assert.equal((screen.match(/setRollCallTarget\(\{/g) ?? []).length, 1, "un seul point d'ouverture de l'appel");
  assert.match(screen, /scopeKey=\{rollCallPickerScope\}/);
});

test("sélecteur : même chargeur lié à l'identité, clé relue à chaque rendu", () => {
  assert.match(picker, /createScopedRollCallClassLoader<RollCallClassOption>\(listOfflineRollCallClasses\)/);
  assert.match(picker, /scopeRef\.current = scopeKey;/);
  assert.match(picker, /loadRollCallClasses\(scopeKey, \(\) => scopeRef\.current\)/);
  assert.doesNotMatch(picker, /lastLists/, "plus de cache hors chargeur lié à l'identité");
});

test("présences manuelles et NFC inchangées : enregistrement manuel et actions de carte intacts", () => {
  assert.match(screen, /onPress=\{\(\) => saveCall\(selectedClass\)\}/);
  assert.match(screen, /onPress=\{\(\) => markClassPresent\(selectedClass\)\}/);
  assert.equal((screen.match(/\{cardActions\}/g) ?? []).length, 2);
  assert.match(screen, /<OfflineRollCallModal\s+visible\s+session=\{session\}\s+classId=\{rollCallTarget\.classId\}/);
});
