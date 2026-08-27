/**
 * Lectures Mobile L1 hors ligne — cache ready uniquement, partition stricte, fail-closed enseignant.
 *   npx --yes tsx src/offline/l1/l1OfflineReads.test.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  filterL1AssignmentsForTeacherSession,
  l1AssignmentBelongsToTeacherSession,
  l1TeacherUserIdOf,
  listCanonicalTeacherAssignments,
  listL1TeacherAssignments,
  scopedClassesForSession,
  scopedStudentsForSession,
} from "../../lib/establishment";
import { snapshotFromL1Cache, snapshotL1Unavailable } from "../../lib/dataTruth";
import { displayedOccurrencesForDay } from "../../lib/planningV2";
import {
  adoptL1Runtime,
  resetL1LifecycleForTests,
  resolveL1Partition,
} from "./lifecycle";
import { createMemoryL1Bucket, createMemoryL1Store } from "./memoryStore";
import {
  isStrictNetworkUnavailable,
  l1ReadInteractionPolicy,
  loadL1BackedSnapshot,
  readL1Resource,
  setL1ReadDepsForTests,
  shouldBlockUnsupportedMutations,
  shouldSkipMetierGet,
  snapshotFromL1Read,
} from "./readModel";
import { applyL1PageAtomically, markResourceState } from "./repository";
import type { L1Page, L1Partition, L1Resource } from "./types";
import {
  projectL1Assignments,
  projectL1Classes,
  projectL1CourseSchedules,
  projectL1SchoolCourses,
  projectL1Students,
} from "./uiProjection";

const ROOT = path.resolve(__dirname, "../../..");

const partitionA: L1Partition = { userId: "user-a", schoolId: "school-1", schoolCode: "SCH-1" };
const partitionB: L1Partition = { userId: "user-b", schoolId: "school-1", schoolCode: "SCH-1" };
const partitionA2: L1Partition = { userId: "user-a", schoolId: "school-2", schoolCode: "SCH-2" };

const sessionA = {
  user: { id: "user-a", schoolId: "school-1", schoolCode: "SCH-1" },
  school: { id: "school-1", code: "SCH-1" },
};
const sessionB = {
  user: { id: "user-b", schoolId: "school-1", schoolCode: "SCH-1" },
  school: { id: "school-1", code: "SCH-1" },
};
const sessionA2 = {
  user: { id: "user-a", schoolId: "school-2", schoolCode: "SCH-2" },
  school: { id: "school-2", code: "SCH-2" },
};
const teacherSession = {
  role: "teacher",
  user: { id: "user-a", schoolId: "school-1", schoolCode: "SCH-1" },
  school: { id: "school-1", code: "SCH-1" },
};

function page(resource: L1Resource, items: L1Page["items"], extra: Partial<L1Page> = {}): L1Page {
  return {
    resource,
    mode: "full",
    cursorStatus: "ok",
    scopeHash: "scope-a",
    items,
    nextCursor: "cursor-1",
    hasMore: false,
    ...extra,
  };
}

function httpError(status: number, code: string): Error {
  const error = new Error(code) as Error & { status: number; code: string };
  error.status = status;
  error.code = code;
  return error;
}

async function seedReady(
  store: ReturnType<typeof createMemoryL1Store>,
  partition: L1Partition,
  resource: L1Resource,
  items: L1Page["items"],
) {
  await applyL1PageAtomically(store, partition, resource, page(resource, items), "ready");
}

async function run() {
  resetL1LifecycleForTests();
  setL1ReadDepsForTests(null);

  const classesSrc = fs.readFileSync(path.join(ROOT, "src/screens/ClassesScreen.tsx"), "utf8");
  const studentsSrc = fs.readFileSync(path.join(ROOT, "src/screens/StudentsScreen.tsx"), "utf8");
  const timetableSrc = fs.readFileSync(path.join(ROOT, "src/screens/TimetableScreen.tsx"), "utf8");
  const pedagogySrc = fs.readFileSync(path.join(ROOT, "src/screens/SchoolPedagogicalStructureScreen.tsx"), "utf8");
  const detailSrc = fs.readFileSync(path.join(ROOT, "src/screens/StudentDetailScreen.tsx"), "utf8");
  for (const [name, source] of [
    ["ClassesScreen", classesSrc],
    ["StudentsScreen", studentsSrc],
    ["TimetableScreen", timetableSrc],
    ["SchoolPedagogicalStructureScreen", pedagogySrc],
    ["StudentDetailScreen", detailSrc],
  ] as const) {
    assert.doesNotMatch(source, /expo-sqlite/, `${name} ne doit pas ouvrir SQLite`);
    assert.doesNotMatch(source, /readL1Resource/, `${name} ne doit pas appeler le lecteur SQLite`);
    assert.doesNotMatch(source, /listRows\(/, `${name} ne doit pas lister SQLite`);
  }

  const establishmentSrc = fs.readFileSync(path.join(ROOT, "src/lib/establishment.ts"), "utf8");
  assert.match(establishmentSrc, /teacherUserId/);
  assert.match(establishmentSrc, /teacher_user_id/);

  const dataTruthSrc = fs.readFileSync(path.join(ROOT, "src/lib/dataTruth.ts"), "utf8");
  assert.match(dataTruthSrc, /source\?:/);
  assert.match(dataTruthSrc, /l1-cache/);

  const readModelSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/readModel.ts"), "utf8");
  assert.match(readModelSrc, /logRc2L1ReadFromSnapshot/);
  const runtimeSrc = fs.readFileSync(path.join(ROOT, "src/offline/l1/L1CacheRuntime.tsx"), "utf8");
  assert.match(runtimeSrc, /logRc2OfflineBoot/);

  const bucket = createMemoryL1Bucket();
  const store = createMemoryL1Store({ bucket });
  await store.migrate();
  setL1ReadDepsForTests({
    openStore: async () => ({ ok: true, store }),
  });

  await seedReady(store, partitionA, "classes", [
    {
      id: "cls-6a",
      classCode: "CLS-6A",
      name: "6ème A",
      academicYearId: "year-1",
      levelId: "lvl-1",
      streamId: null,
      groupId: "grp-1",
      status: "active",
    },
    {
      id: "cls-5b",
      classCode: "CLS-5B",
      name: "5ème B",
      academicYearId: "year-1",
      status: "active",
    },
  ]);
  await seedReady(store, partitionA, "students", [
    {
      id: "stu-1",
      studentCode: "STU-001",
      firstName: "Esther",
      lastName: "Okito",
      classId: "cls-6a",
      classCode: "CLS-6A",
      academicYearId: "year-1",
      status: "active",
    },
  ]);
  await seedReady(store, partitionA, "assignments", [
    {
      id: "asg-1",
      teacherId: "tch-a",
      teacherCode: "ENS-A",
      teacherUserId: "user-a",
      classId: "cls-6a",
      classCode: "CLS-6A",
      subjectId: "sub-math",
      subjectCode: "MATH",
      academicYearId: "year-1",
      assignmentRole: "titulaire",
      status: "active",
    },
  ]);
  await seedReady(store, partitionA, "school-courses", [
    {
      id: "crs-1",
      courseCode: "CRS-MATH-6A",
      classId: "cls-6a",
      classCode: "CLS-6A",
      subjectId: "sub-math",
      subjectCode: "MATH",
      teacherCode: "ENS-A",
      coefficient: 4,
      status: "active",
    },
  ]);
  await seedReady(store, partitionA, "course-schedules", [
    {
      id: "slot-1",
      schoolCourseId: "crs-1",
      courseCode: "CRS-MATH-6A",
      academicYearId: "year-1",
      classId: "cls-6a",
      classCode: "CLS-6A",
      subjectCode: "MATH",
      teacherId: "tch-a",
      teacherCode: "ENS-A",
      roomId: "room-1",
      roomCode: "S12",
      dayOfWeek: 1,
      startTime: "08:00",
      endTime: "09:00",
      status: "active",
    },
  ]);

  const classesRead = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.equal(classesRead.ok, true);
  if (!classesRead.ok) throw new Error("classes ready");
  const classes = projectL1Classes(classesRead);
  assert.equal(classes.length, 2);
  const sixth = classes.find((row) => row.classCode === "CLS-6A");
  assert.ok(sixth);
  assert.equal(sixth.publicId, "CLS-6A");
  assert.equal(sixth.schoolCode, "SCH-1");
  assert.equal(sixth.classCode, "CLS-6A");
  assert.equal(sixth.level, "", "pas de nom de niveau inventé");
  const classesSnapshot = snapshotFromL1Cache(classes, classesRead.meta.lastSuccessAt);
  assert.equal(classesSnapshot.status, "success");
  assert.equal(classesSnapshot.source, "l1-cache");

  const studentsRead = await readL1Resource({ session: sessionA, resource: "students" });
  assert.equal(studentsRead.ok, true);
  if (!studentsRead.ok) throw new Error("students ready");
  const students = projectL1Students(studentsRead, classesRead.rows);
  assert.equal(students.length, 1);
  assert.equal(students[0].matricule, "STU-001");
  assert.equal(students[0].studentCode, "STU-001");
  assert.equal(students[0].name, "Esther Okito");
  assert.equal(students[0].className, "6ème A", "className joint localement");
  assert.equal(students[0].gender, "", "sexe absent du L1 — ne pas inventer");
  assert.equal(detailSrc.includes("Non renseigné"), true);

  await store.purgeResource(partitionA, "students");
  await applyL1PageAtomically(store, partitionA, "students", page("students", []), "ready");
  const emptyStudents = await readL1Resource({ session: sessionA, resource: "students" });
  assert.equal(emptyStudents.ok, true);
  if (!emptyStudents.ok) throw new Error("empty ready");
  const emptySnapshot = snapshotFromL1Cache(projectL1Students(emptyStudents, classesRead.rows), emptyStudents.meta.lastSuccessAt);
  assert.equal(emptySnapshot.status, "empty");
  assert.equal(emptySnapshot.source, "l1-cache");
  assert.deepEqual(emptySnapshot.data, []);

  await seedReady(store, partitionA, "students", [
    {
      id: "stu-1",
      studentCode: "STU-001",
      firstName: "Esther",
      lastName: "Okito",
      classId: "cls-6a",
      classCode: "CLS-6A",
      status: "active",
    },
  ]);

  const assignmentsRead = await readL1Resource({ session: sessionA, resource: "assignments" });
  assert.equal(assignmentsRead.ok, true);
  if (!assignmentsRead.ok) throw new Error("assignments ready");
  const assignments = projectL1Assignments(assignmentsRead, classesRead.rows);
  assert.equal(assignments[0].teacherUserId, "user-a");
  assert.equal(assignments[0].className, "6ème A");
  assert.equal(assignments[0].course, "MATH");
  const scoped = listCanonicalTeacherAssignments(teacherSession, { assignments, classes });
  assert.equal(scoped.length, 1);
  assert.equal(scoped[0].classCode, "CLS-6A");

  const teacherBSession = {
    role: "teacher",
    user: { id: "user-b", schoolId: "school-1", schoolCode: "SCH-1" },
    school: { id: "school-1", code: "SCH-1" },
  };
  const teacherBAssignments = listCanonicalTeacherAssignments(teacherBSession, { assignments, classes });
  assert.equal(teacherBAssignments.length, 0, "teacher B ne voit pas la classe de A");
  assert.deepEqual(scopedClassesForSession(teacherBSession, classes, students, { assignments, classes }), []);
  assert.deepEqual(scopedStudentsForSession(teacherBSession, students, { assignments, classes }), []);

  const teacherNoAsg = listCanonicalTeacherAssignments(teacherSession, { assignments: [], classes });
  assert.equal(teacherNoAsg.length, 0);
  assert.deepEqual(scopedClassesForSession(teacherSession, classes, students, { assignments: [], classes }), []);
  assert.deepEqual(scopedStudentsForSession(teacherSession, students, { assignments: [], classes }), []);

  const teacherWithLegacyRefs = {
    role: "teacher",
    user: {
      id: "user-a",
      schoolId: "school-1",
      schoolCode: "SCH-1",
      teacherId: "tch-a",
      teacherCode: "ENS-A",
    },
    school: { id: "school-1", code: "SCH-1" },
  };
  const legacyAssignment = {
    id: "asg-legacy",
    teacherId: "tch-a",
    teacherCode: "ENS-A",
    className: "6ème A",
    classCode: "CLS-6A",
    course: "MATH",
    status: "active",
  };
  assert.equal(
    listCanonicalTeacherAssignments(teacherWithLegacyRefs, { assignments: [legacyAssignment] }).length,
    1,
    "matching en ligne KILOMBO : teacherCode/teacherId restent valides",
  );
  assert.equal(
    listL1TeacherAssignments(teacherWithLegacyRefs, { assignments: [legacyAssignment] }).length,
    0,
    "teacherUserId absent ⇒ aucune affectation L1",
  );
  assert.equal(l1TeacherUserIdOf({ ...legacyAssignment, teacherUserId: null }), "");
  assert.equal(l1TeacherUserIdOf({ teacher_user_id: null, teacherCode: "ENS-A" }), "");
  assert.equal(
    l1AssignmentBelongsToTeacherSession({ ...legacyAssignment, teacherUserId: null }, teacherWithLegacyRefs),
    false,
    "teacherUserId null ⇒ refus L1 même si teacherCode/teacherId collent",
  );
  assert.equal(
    listL1TeacherAssignments(teacherWithLegacyRefs, {
      assignments: [{ ...legacyAssignment, teacherUserId: "user-other" }],
    }).length,
    0,
    "teacherUserId mismatch ⇒ aucune affectation L1",
  );
  assert.equal(
    listL1TeacherAssignments(teacherWithLegacyRefs, {
      assignments: [{ ...legacyAssignment, teacherUserId: "user-a" }],
    }).length,
    1,
    "teacherUserId === session.user.id ⇒ affectation L1",
  );
  const l1CanonicalState = (row: Record<string, unknown>) => ({
    assignments: [row as import("../../data/catalog").TeacherAssignment],
    assignmentsSource: "l1-cache" as const,
  });
  assert.equal(
    listCanonicalTeacherAssignments(teacherWithLegacyRefs, l1CanonicalState(legacyAssignment)).length,
    0,
    "listCanonical L1: teacherUserId absent ⇒ [] même si teacherCode/teacherId collent",
  );
  assert.equal(
    listCanonicalTeacherAssignments(
      teacherWithLegacyRefs,
      l1CanonicalState({ ...legacyAssignment, teacherUserId: null }),
    ).length,
    0,
    "listCanonical L1: teacherUserId null ⇒ []",
  );
  assert.equal(
    listCanonicalTeacherAssignments(
      teacherWithLegacyRefs,
      l1CanonicalState({ ...legacyAssignment, teacherUserId: "user-other" }),
    ).length,
    0,
    "listCanonical L1: teacherUserId mismatch ⇒ []",
  );
  assert.equal(
    listCanonicalTeacherAssignments(
      teacherWithLegacyRefs,
      l1CanonicalState({ ...legacyAssignment, teacherUserId: "user-a" }),
    ).length,
    1,
    "listCanonical L1: teacherUserId === session.user.id ⇒ 1",
  );
  const l1ProjectedMissingUid = filterL1AssignmentsForTeacherSession(
    projectL1Assignments(
      {
        ok: true,
        partition: partitionA,
        meta: assignmentsRead.meta,
        rows: [
          {
            id: "asg-no-uid",
            teacher_id: "tch-a",
            teacher_code: "ENS-A",
            class_id: "cls-6a",
            class_code: "CLS-6A",
            subject_code: "MATH",
            status: "active",
            teacher_user_id: null,
          },
        ],
      },
      classesRead.rows,
    ),
    teacherWithLegacyRefs,
  );
  assert.equal(l1ProjectedMissingUid.length, 0, "projection L1 sans teacher_user_id ⇒ vide enseignant");
  const l1TeacherReady = await loadL1BackedSnapshot({
    session: teacherWithLegacyRefs,
    permissionsBootstrap: "ready_offline",
    resource: "assignments",
    fetchNetwork: async () => {
      throw new Error("GET interdit en ready_offline");
    },
    project: (read) =>
      filterL1AssignmentsForTeacherSession(projectL1Assignments(read, classesRead.rows), teacherWithLegacyRefs),
  });
  assert.equal(l1TeacherReady.status, "success");
  assert.equal(l1TeacherReady.data.length, 1);
  assert.equal(l1TeacherReady.data[0].teacherUserId, "user-a");

  const coursesRead = await readL1Resource({ session: sessionA, resource: "school-courses" });
  assert.equal(coursesRead.ok, true);
  if (!coursesRead.ok) throw new Error("school-courses ready");
  const courses = projectL1SchoolCourses(coursesRead, classesRead.rows);
  assert.equal(courses[0].className, "6ème A");
  assert.equal(courses[0].subjectCode, "MATH");
  assert.equal(courses[0].courseCode, "CRS-MATH-6A");
  assert.equal(courses[0].name, "MATH", "subjectCode prioritaire, pas de subjectName inventé");
  assert.equal(courses[0].coefficient, 4);
  assert.equal(JSON.stringify(courses).includes("Mathématiques"), false);

  const unnamedCourse = projectL1SchoolCourses(
    {
      ok: true,
      partition: partitionA,
      meta: coursesRead.meta,
      rows: [{ id: "crs-x", course_code: "CRS-X", class_code: "CLS-6A", coefficient: "2", status: "active" }],
    },
    classesRead.rows,
  );
  assert.equal(unnamedCourse[0].name, "CRS-X");
  const fallbackCourse = projectL1SchoolCourses(
    {
      ok: true,
      partition: partitionA,
      meta: coursesRead.meta,
      rows: [{ id: "crs-y", class_code: "CLS-6A", status: "active" }],
    },
    classesRead.rows,
  );
  assert.equal(fallbackCourse[0].name, "Cours");

  const slotsRead = await readL1Resource({ session: sessionA, resource: "course-schedules" });
  assert.equal(slotsRead.ok, true);
  if (!slotsRead.ok) throw new Error("course-schedules ready");
  const slots = projectL1CourseSchedules(slotsRead, classesRead.rows);
  assert.equal(slots[0].className, "6ème A");
  assert.equal(slots[0].courseName, "MATH");
  assert.equal(slots[0].teacherName, "ENS-A");
  assert.equal(slots[0].roomName, "S12");
  assert.equal(JSON.stringify(slots).includes("Salle principale"), false);
  const occurrences = displayedOccurrencesForDay({
    slots,
    replacements: [],
    dayOfWeek: 1,
    occurrenceDate: "2026-08-24",
    unverified: true,
  });
  assert.equal(occurrences[0].replacementsUnverified, true);

  await markResourceState(store, partitionA, "students", { state: "reconciling" });
  const reconciling = await readL1Resource({ session: sessionA, resource: "students" });
  assert.deepEqual(reconciling, { ok: false, reason: "reconciling" });
  const classesStillReady = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.equal(classesStillReady.ok, true, "classes ready indépendant de students reconciling");
  await markResourceState(store, partitionA, "students", { state: "ready" });

  await markResourceState(store, partitionA, "school-courses", { state: "blocked_authorization" });
  const blocked = await readL1Resource({ session: sessionA, resource: "school-courses" });
  assert.deepEqual(blocked, { ok: false, reason: "blocked_authorization" });
  assert.equal((await readL1Resource({ session: sessionA, resource: "classes" })).ok, true);
  await markResourceState(store, partitionA, "school-courses", { state: "ready" });

  const absent = await readL1Resource({ session: sessionA, resource: "students" });
  assert.equal(absent.ok, true);
  const missingMetaStore = createMemoryL1Store();
  await missingMetaStore.migrate();
  setL1ReadDepsForTests({ openStore: async () => ({ ok: true, store: missingMetaStore }) });
  const noMeta = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.deepEqual(noMeta, { ok: false, reason: "metadata_absent" });
  setL1ReadDepsForTests({ openStore: async () => ({ ok: true, store }) });

  await seedReady(store, partitionB, "classes", [
    { id: "cls-secret", classCode: "CLS-B", name: "Classe B", status: "active" },
  ]);
  const userBSees = await readL1Resource({ session: sessionB, resource: "classes" });
  assert.equal(userBSees.ok, true);
  if (!userBSees.ok) throw new Error("b classes");
  assert.equal(projectL1Classes(userBSees).some((row) => row.id === "cls-6a"), false);
  assert.equal(projectL1Classes(userBSees)[0].id, "cls-secret");
  const userASees = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.equal(userASees.ok, true);
  if (!userASees.ok) throw new Error("a classes");
  assert.equal(projectL1Classes(userASees).some((row) => row.id === "cls-secret"), false);

  await seedReady(store, partitionA2, "classes", [
    { id: "cls-s2", classCode: "CLS-S2", name: "Classe S2", status: "active" },
  ]);
  const school2 = await readL1Resource({ session: sessionA2, resource: "classes" });
  assert.equal(school2.ok, true);
  if (!school2.ok) throw new Error("school2");
  assert.equal(projectL1Classes(school2).some((row) => row.id === "cls-6a"), false);
  assert.equal(projectL1Classes(school2)[0].id, "cls-s2");

  let networkCalls = 0;
  const networkUnavailable = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready",
    resource: "classes",
    fetchNetwork: async () => {
      networkCalls += 1;
      throw httpError(0, "NETWORK_UNAVAILABLE");
    },
    project: (read) => projectL1Classes(read),
  });
  assert.equal(networkCalls, 1);
  assert.equal(networkUnavailable.source, "l1-cache");
  assert.equal(networkUnavailable.status, "success");
  assert.ok(networkUnavailable.data.length > 0);

  networkCalls = 0;
  const readyOffline = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready_offline",
    resource: "classes",
    fetchNetwork: async () => {
      networkCalls += 1;
      throw new Error("GET interdit en ready_offline");
    },
    project: (read) => projectL1Classes(read),
  });
  assert.equal(networkCalls, 0, "ready_offline → SQLite sans GET");
  assert.equal(readyOffline.source, "l1-cache");
  assert.equal(shouldSkipMetierGet("ready_offline"), true);

  for (const [label, error] of [
    ["403", httpError(403, "FORBIDDEN")],
    ["401", httpError(401, "UNAUTHORIZED")],
    ["500", httpError(500, "SERVER")],
    ["timeout", httpError(0, "TIMEOUT")],
  ] as const) {
    networkCalls = 0;
    const snapshot = await loadL1BackedSnapshot({
      session: sessionA,
      permissionsBootstrap: "ready",
      resource: "classes",
      fetchNetwork: async () => {
        networkCalls += 1;
        throw error;
      },
      project: (read) => projectL1Classes(read),
    });
    assert.equal(networkCalls, 1, label);
    assert.notEqual(snapshot.source, "l1-cache", `${label} aucun fallback cache`);
    assert.equal(snapshot.status, "error", `${label} n'est pas offline`);
    assert.deepEqual(snapshot.data, []);
  }
  assert.equal(isStrictNetworkUnavailable(httpError(0, "TIMEOUT")), false);
  assert.equal(isStrictNetworkUnavailable(httpError(500, "SERVER")), false);
  assert.equal(isStrictNetworkUnavailable(httpError(0, "NETWORK_UNAVAILABLE")), true);

  const online = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready",
    resource: "classes",
    fetchNetwork: async () => [{ id: "net-1", publicId: "NET", name: "Réseau", level: "", track: "", teacherId: "" }],
    project: (read) => projectL1Classes(read),
  });
  assert.equal(online.source, "network");
  assert.equal(online.status, "success");

  const cachedPolicy = l1ReadInteractionPolicy({
    snapshot: classesSnapshot,
    permissionsBootstrap: "ready_offline",
  });
  assert.equal(cachedPolicy.searchEnabled, true);
  assert.equal(cachedPolicy.navigationEnabled, true);
  assert.equal(cachedPolicy.mutationsEnabled, false);
  assert.equal(shouldBlockUnsupportedMutations({ source: "l1-cache" }), true);
  assert.equal(shouldBlockUnsupportedMutations({ permissionsBootstrap: "ready_offline" }), true);
  assert.equal(shouldBlockUnsupportedMutations({ source: "network", permissionsBootstrap: "ready" }), false);
  assert.match(classesSrc, /editable=\{!showLoading\}/);
  assert.match(classesSrc, /networkRequired=\{mutationsBlocked\}/);
  assert.match(studentsSrc, /networkRequired=\{mutationsBlocked\}/);
  assert.match(timetableSrc, /mutationsBlocked/);
  assert.match(pedagogySrc, /mutationRequiresConnection/);

  const unavailable = snapshotL1Unavailable();
  assert.equal(unavailable.status, "offline");
  assert.deepEqual(unavailable.data, []);
  assert.equal(unavailable.source, undefined);

  resetL1LifecycleForTests();
  const relaunchStore = createMemoryL1Store({ bucket });
  await relaunchStore.migrate();
  setL1ReadDepsForTests({
    openStore: async () => ({ ok: true, store: relaunchStore }),
  });
  const afterRelaunch = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.equal(afterRelaunch.ok, true, "kill/relaunch simulé : même bucket, nouveau runtime");
  if (!afterRelaunch.ok) throw new Error("relaunch");
  assert.ok(projectL1Classes(afterRelaunch).length >= 1);
  await adoptL1Runtime(relaunchStore, partitionA);
  const remembered = await readL1Resource({ session: sessionA, resource: "course-schedules" });
  assert.equal(remembered.ok, true);

  const unresolved = resolveL1Partition({ user: { id: "user-a" } });
  assert.equal(unresolved.ok, false);
  const noPartition = await readL1Resource({
    session: { user: { id: "user-a" } },
    resource: "classes",
  });
  assert.deepEqual(noPartition, { ok: false, reason: "partition_unresolved" });

  setL1ReadDepsForTests({
    openStore: async () => ({
      ok: false,
      code: "L1_SQLCIPHER_REQUIRED",
      message: "SQLCipher requis",
    }),
  });
  const cipher = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.deepEqual(cipher, { ok: false, reason: "sqlcipher_unavailable" });

  const listRowsBoomStore = {
    ...relaunchStore,
    async listRows() {
      throw Object.assign(new Error("database is locked"), { code: "SQLITE_ERROR" });
    },
  };
  setL1ReadDepsForTests({
    openStore: async () => ({ ok: true, store: listRowsBoomStore }),
  });
  const listRowsBoom = await readL1Resource({ session: sessionA, resource: "classes" });
  assert.deepEqual(listRowsBoom, { ok: false, reason: "sqlcipher_unavailable" });
  const listRowsBoomSnapshot = snapshotFromL1Read(listRowsBoom, projectL1Classes);
  assert.equal(listRowsBoomSnapshot.status, "offline");
  assert.deepEqual(listRowsBoomSnapshot.data, []);
  assert.equal(listRowsBoomSnapshot.source, undefined);
  const listRowsBoomLoad = await loadL1BackedSnapshot({
    session: sessionA,
    permissionsBootstrap: "ready_offline",
    resource: "classes",
    fetchNetwork: async () => {
      throw new Error("GET interdit en ready_offline");
    },
    project: (read) => projectL1Classes(read),
  });
  assert.equal(listRowsBoomLoad.status, "offline", "listRows throws ⇒ offline, jamais données anciennes");
  assert.deepEqual(listRowsBoomLoad.data, []);

  setL1ReadDepsForTests(null);
  resetL1LifecycleForTests();
  console.log("OK: mobile L1 offline reads");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
