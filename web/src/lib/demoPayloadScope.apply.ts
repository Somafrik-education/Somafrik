/**
 * Applique les vrais scopers Web sur des payloads API réels.
 * Aucune row synthétique : l'entrée vient du gate PostgreSQL + HTTP.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { BackOfficeState, SessionUser } from "../types";
import { pickInitialSchoolCode, withSchoolScope } from "./activeSchool";
import { scopedAssignments, scopedClasses, scopedNotes, scopedPayments, scopedPresences, scopedTeachers } from "./establishment";
import { scopedEvaluations } from "./evaluations";
import { scopedSchools } from "./scope";
import { isV2SchoolLoginCode, projectScopedUsersForSchool } from "./schoolCanonicalIdentity";
import { projectScopedStudents } from "./studentsScope";

type Row = Record<string, unknown>;

export type DemoPayloadScopeInput = {
  sessionUser: SessionUser;
  schools: Row[];
  domains: Record<string, Row[]>;
};

function identityOf(row: Row | undefined) {
  if (!row) return null;
  return {
    schoolId: row.schoolId ?? row.school_id ?? null,
    schoolCode: row.schoolCode ?? row.school_code ?? null,
    schoolPublicCode: row.schoolPublicCode ?? row.school_public_code ?? null,
    loginCode: row.loginCode ?? row.login_code ?? null,
  };
}

function emptyState(domains: Record<string, Row[]>): BackOfficeState {
  return {
    schools: domains.schools ?? [],
    students: domains.students ?? [],
    classes: domains.classes ?? [],
    teachers: domains.teachers ?? [],
    users: domains.users ?? [],
    notes: domains.notes ?? [],
    evaluations: domains.evaluations ?? [],
    presences: domains.presences ?? [],
    payments: domains.payments ?? [],
    assignments: domains.assignments ?? [],
    courseSchedules: domains.courseSchedules ?? [],
  } as BackOfficeState;
}

export function applyDemoPayloadScope(input: DemoPayloadScopeInput) {
  const schools = input.schools ?? [];
  const schoolCodes = schools
    .map((school) => String(school.code ?? school.schoolCode ?? school.loginCode ?? "").trim())
    .filter(Boolean);
  const activeSchoolCode = pickInitialSchoolCode(input.sessionUser, schoolCodes);
  const scopedUser = withSchoolScope(input.sessionUser, activeSchoolCode) ?? input.sessionUser;
  const state = emptyState({ ...input.domains, schools });

  const studentsProjection = projectScopedStudents(scopedUser, state);
  const usersProjection = projectScopedUsersForSchool(scopedUser, (state.users ?? []) as never);
  const schoolsScoped = scopedSchools(scopedUser, state);

  const classes = scopedClasses(scopedUser, state);
  const teachers = scopedTeachers(scopedUser, state);
  const notes = scopedNotes(scopedUser, state);
  const evaluations = scopedEvaluations(scopedUser, state);
  const presences = scopedPresences(scopedUser, state);
  const payments = scopedPayments(scopedUser, state);
  const assignments = scopedAssignments(scopedUser, state);
  const classNames = new Set(classes.map((row) => String(row.name ?? row.className ?? "").trim()).filter(Boolean));
  const courseSchedules = ((state.courseSchedules ?? []) as Row[]).filter((row) => {
    const rowCode = String(row.schoolCode ?? "").trim().toUpperCase();
    const sessionCode = String(scopedUser.schoolCode ?? "").trim().toUpperCase();
    const publicCode = String(scopedUser.schoolPublicCode ?? "").trim().toUpperCase();
    const className = String(row.className ?? "").trim();
    return rowCode === sessionCode || (publicCode && rowCode === publicCode) || (className && classNames.has(className));
  });

  const sessionSchoolId = String(scopedUser.schoolId ?? "").trim();
  const sessionPublic = String(scopedUser.schoolPublicCode ?? "").trim();
  const sessionCode = String(scopedUser.schoolCode ?? "").trim();

  return {
    session: {
      schoolId: sessionSchoolId || null,
      schoolPublicCode: sessionPublic || null,
      schoolCode: sessionCode || null,
      activeSchoolCode,
      scopedUserSchoolCode: sessionCode || null,
      hasSchoolId: Boolean(sessionSchoolId),
      hasPublicCode: Boolean(sessionPublic),
      schoolCodeIsV2: isV2SchoolLoginCode(sessionCode),
    },
    traces: {
      students: studentsProjection.trace,
      users: usersProjection.trace,
    },
    domains: {
      schools: {
        mapped: (input.domains.schools ?? schools).length,
        scoped: schoolsScoped.length,
        firstMapped: identityOf((input.domains.schools ?? schools)[0]),
      },
      users: {
        mapped: (input.domains.users ?? []).length,
        scoped: usersProjection.kept,
        error: usersProjection.error?.code ?? null,
        firstMapped: identityOf(input.domains.users?.[0]),
      },
      students: {
        mapped: (input.domains.students ?? []).length,
        scoped: studentsProjection.kept,
        error: studentsProjection.error?.code ?? null,
        firstMapped: identityOf(input.domains.students?.[0]),
      },
      classes: {
        mapped: (input.domains.classes ?? []).length,
        scoped: classes.length,
        firstMapped: identityOf(input.domains.classes?.[0]),
      },
      teachers: {
        mapped: (input.domains.teachers ?? []).length,
        scoped: teachers.length,
        firstMapped: identityOf(input.domains.teachers?.[0]),
      },
      notes: {
        mapped: (input.domains.notes ?? []).length,
        scoped: notes.length,
        firstMapped: identityOf(input.domains.notes?.[0]),
      },
      evaluations: {
        mapped: (input.domains.evaluations ?? []).length,
        scoped: evaluations.length,
        firstMapped: identityOf(input.domains.evaluations?.[0] as Row | undefined),
      },
      presences: {
        mapped: (input.domains.presences ?? []).length,
        scoped: presences.length,
        firstMapped: identityOf(input.domains.presences?.[0]),
      },
      payments: {
        mapped: (input.domains.payments ?? []).length,
        scoped: payments.length,
        firstMapped: identityOf(input.domains.payments?.[0]),
      },
      assignments: {
        mapped: (input.domains.assignments ?? []).length,
        scoped: assignments.length,
        firstMapped: identityOf(input.domains.assignments?.[0]),
      },
      courseSchedules: {
        mapped: (input.domains.courseSchedules ?? []).length,
        scoped: courseSchedules.length,
        firstMapped: identityOf(input.domains.courseSchedules?.[0]),
      },
    },
  };
}

function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];
  if (!inputPath || !outputPath) {
    throw new Error("usage: tsx web/src/lib/demoPayloadScope.apply.ts <input.json> <output.json>");
  }
  const input = JSON.parse(readFileSync(inputPath, "utf8")) as DemoPayloadScopeInput;
  const result = applyDemoPayloadScope(input);
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv.some((arg) => arg.includes("demoPayloadScope.apply.ts"))) {
  main();
}
