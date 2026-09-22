/**
 * PARENT-1D — Présences Mobile : loading / error / offline / retry.
 *   npx --yes tsx src/lib/studentPresencesQueryState.test.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { STUDENT_SUB_SCREENS_COPY, STUDENT_SUB_SCREENS_TEST_IDS } from "./studentSubScreensSpec";
import {
  filterPresencesForAliases,
  reloadStudentPresences,
  resolveStudentPresencesView,
  studentPresencesVisibleState,
} from "./studentPresencesQueryState";

const CHILD_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ALIASES_A = [CHILD_A, "CD-IN-26-A"];

const rowA = { id: "p-a", studentId: CHILD_A, date: "2026-09-01" };
const rowB = { id: "p-b", studentId: CHILD_B, date: "2026-09-01" };

function readScreen() {
  const candidates = [
    join(process.cwd(), "src/screens/StudentPresencesScreen.tsx"),
    join(process.cwd(), "Mobile/src/screens/StudentPresencesScreen.tsx"),
  ];
  const path = candidates.find((item) => existsSync(item));
  assert.ok(path, "StudentPresencesScreen.tsx introuvable");
  return readFileSync(path, "utf8");
}

function run() {
  assert.deepEqual(filterPresencesForAliases([rowA, rowB], ALIASES_A), [rowA]);
  assert.deepEqual(filterPresencesForAliases([rowA, rowB], []), []);
  assert.deepEqual(filterPresencesForAliases([rowB], ALIASES_A), []);
  assert.deepEqual(
    filterPresencesForAliases([{ id: "blank", studentId: "", date: "2026-09-02" }, rowA], ALIASES_A),
    [rowA],
  );

  const loading = { status: "loading" as const, data: [rowB] };
  assert.equal(studentPresencesVisibleState(loading, [rowA]), "loading");
  assert.equal(resolveStudentPresencesView(loading, [rowA]).kind, "query");

  const idle = { status: "idle" as const, data: [rowA] };
  assert.equal(studentPresencesVisibleState(idle, [rowA]), "loading");

  const failed = { status: "error" as const, data: [rowB], errorMessage: "Impossible de charger les présences." };
  assert.equal(studentPresencesVisibleState(failed, []), "error");
  assert.equal(studentPresencesVisibleState(failed, [rowA]), "error");
  const failedView = resolveStudentPresencesView(failed, [rowA]);
  assert.equal(failedView.kind, "query");
  if (failedView.kind === "query") {
    assert.equal(failedView.snapshot.status, "error");
    assert.notEqual(failedView.snapshot.status, "empty");
  }

  const offline = { status: "offline" as const, data: [rowA], errorMessage: "network" };
  assert.equal(studentPresencesVisibleState(offline, [rowA]), "offline");
  assert.equal(studentPresencesVisibleState(offline, []), "offline");
  assert.notEqual(studentPresencesVisibleState(offline, []), "empty");

  const emptySnapshot = { status: "empty" as const, data: [] as typeof rowA[] };
  assert.equal(studentPresencesVisibleState(emptySnapshot, []), "empty");

  const success = { status: "success" as const, data: [rowA, rowB] };
  assert.equal(studentPresencesVisibleState(success, [rowA]), "list");
  assert.equal(studentPresencesVisibleState(success, []), "empty");
  const successView = resolveStudentPresencesView(success, filterPresencesForAliases([rowA, rowB], ALIASES_A));
  assert.equal(successView.kind, "list");
  if (successView.kind === "list") {
    assert.deepEqual(successView.rows, [rowA]);
    assert.ok(successView.rows.every((row) => row.studentId !== CHILD_B));
  }

  const calls: string[] = [];
  reloadStudentPresences(async () => {
    calls.push("presences");
    return true;
  });
  assert.deepEqual(calls, ["presences"]);

  assert.notEqual(STUDENT_SUB_SCREENS_COPY.presencesEmpty, STUDENT_SUB_SCREENS_COPY.presencesError);
  assert.notEqual(STUDENT_SUB_SCREENS_COPY.presencesEmpty, STUDENT_SUB_SCREENS_COPY.presencesOffline);
  assert.notEqual(STUDENT_SUB_SCREENS_COPY.presencesError, STUDENT_SUB_SCREENS_COPY.presencesOffline);
  assert.equal(STUDENT_SUB_SCREENS_TEST_IDS.presencesError, "student-presences-error");

  const screen = readScreen();
  assert.match(screen, /useParentStudentRouteSelection/);
  assert.match(screen, /resolveParentSafeStudentId/);
  assert.match(screen, /filterPresencesForAliases\(presencesData, studentAliasKeys\)/);
  assert.match(screen, /resolveStudentPresencesView\(presencesSnapshot, presencesEleve\)/);
  assert.match(screen, /presencesView\.kind === "list"/);
  assert.match(screen, /data=\{presencesView\.rows\}/);
  assert.doesNotMatch(screen, /data=\{presencesData\}/);
  assert.match(screen, /metricLabelFromSnapshot/);
  assert.match(screen, /useFocusEffect/);
  assert.match(screen, /void loadPresences\(\)/);

  const marker = 'presencesView.kind === "list"';
  const after = screen.slice(screen.indexOf(marker));
  assert.ok(after.length > 0);
  const flat = after.indexOf("<FlatList");
  const query = after.indexOf("<QueryStateView");
  assert.ok(flat >= 0 && query > flat, "la liste n'est rendue que sur success");
  const listBlock = after.slice(0, query);
  const queryBlock = after.slice(query);
  assert.match(listBlock, /STUDENT_SUB_SCREENS_COPY\.presencesEmpty/);
  assert.doesNotMatch(listBlock, /presencesError|presencesOffline/);
  assert.match(queryBlock, /STUDENT_SUB_SCREENS_COPY\.presencesEmpty/);
  assert.match(queryBlock, /STUDENT_SUB_SCREENS_COPY\.presencesError/);
  assert.match(queryBlock, /STUDENT_SUB_SCREENS_COPY\.presencesOffline/);
  assert.match(queryBlock, /STUDENT_SUB_SCREENS_TEST_IDS\.presencesEmpty/);
  assert.match(queryBlock, /STUDENT_SUB_SCREENS_TEST_IDS\.presencesError/);
  assert.match(queryBlock, /reloadStudentPresences\(loadPresences\)/);
  assert.doesNotMatch(screen, /onRetry=\{\(\) => \{\}\}/);
  assert.doesNotMatch(screen, /onRetry=\{\(\) => undefined\}/);

  console.log("OK: Présences distingue loading, erreur, offline, retry et vide métier");
}

run();
