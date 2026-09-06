/**
 * Identité métier élève côté session Mobile.
 * students.id (linkedStudent.studentId) gagne toujours sur users.id.
 * Les DTO online exposent encore student_code comme Student.id / studentId :
 * les filtres doivent donc matcher UUID + code, jamais users.id.
 */

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

function uniqueNonEmpty(values: Array<unknown>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const key = trim(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

export type LinkedStudentRef = {
  studentId?: string | null;
  studentCode?: string | null;
};

export type SessionChildRef = {
  id?: string | null;
  studentId?: string | null;
  studentUuid?: string | null;
  studentCode?: string | null;
  matricule?: string | null;
  publicId?: string | null;
};

export type SessionUserRef = {
  id?: string;
  matricule?: string | null;
  studentCode?: string | null;
  linkedStudent?: LinkedStudentRef | null;
  children?: SessionChildRef[] | null;
} | null | undefined;

export function resolveSessionStudentId(user: {
  id?: string;
  linkedStudent?: { studentId?: string } | null;
  children?: Array<{ id?: string }>;
} | null | undefined): string | null {
  const fromLink = trim(user?.linkedStudent?.studentId);
  if (fromLink) return fromLink;
  const fromChild = trim(user?.children?.[0]?.id);
  if (fromChild) return fromChild;
  return null;
}

function childAliasKeys(child: SessionChildRef | null | undefined): string[] {
  if (!child) return [];
  return uniqueNonEmpty([
    child.studentUuid,
    child.studentId,
    child.id,
    child.publicId,
    child.matricule,
    child.studentCode,
  ]);
}

/**
 * Alias d'identité pour matcher DTO UUID (L1 / linkedStudent) et DTO student_code (HTTP).
 * Jamais users.id.
 */
export function sessionStudentAliasKeys(input: {
  role?: string | null;
  selectedStudentId?: string | null;
  user?: SessionUserRef;
  children?: SessionChildRef[] | null;
  linkedStudent?: LinkedStudentRef | null;
}): string[] {
  const role = input.role ?? null;
  const user = input.user ?? null;
  const authId = trim(user?.id);
  const linked = input.linkedStudent ?? user?.linkedStudent ?? null;
  const children = input.children ?? user?.children ?? [];

  if (role === "student") {
    const uuid = trim(input.selectedStudentId) || trim(linked?.studentId);
    if (!uuid) return [];
    return uniqueNonEmpty([
      uuid,
      linked?.studentCode,
      user?.matricule,
      user?.studentCode,
    ]).filter((key) => key !== authId);
  }

  if (role === "parent_student") {
    const selected = trim(input.selectedStudentId);
    if (selected) {
      const child = children.find((item) => childAliasKeys(item).includes(selected));
      return uniqueNonEmpty([...(child ? childAliasKeys(child) : []), selected]).filter(
        (key) => key !== authId,
      );
    }
    return uniqueNonEmpty(children.flatMap(childAliasKeys)).filter((key) => key !== authId);
  }

  const selected = trim(input.selectedStudentId);
  return selected && selected !== authId ? [selected] : [];
}

export type StudentIdentityRow = {
  id?: string | null;
  studentId?: string | null;
  studentUuid?: string | null;
  studentCode?: string | null;
  matricule?: string | null;
  publicId?: string | null;
};

export function studentRecordAliasKeys(row: StudentIdentityRow | null | undefined): string[] {
  if (!row) return [];
  return uniqueNonEmpty([
    row.studentUuid,
    row.studentId,
    row.id,
    row.publicId,
    row.matricule,
    row.studentCode,
  ]);
}

export function findStudentByIdentity<T extends StudentIdentityRow>(
  students: T[],
  keys: string[],
): T | undefined {
  const allowed = new Set(keys.map(trim).filter(Boolean));
  if (!allowed.size) return undefined;
  return students.find((row) => studentRecordAliasKeys(row).some((key) => allowed.has(key)));
}

/**
 * Périmètre élève pour les écrans métier (paiements, notes, présences).
 * - student / parent_student : alias UUID + student_code. Vide = fail-closed.
 * - autres rôles (admin/staff) : unscoped.
 */
export type MobileStudentScope = {
  role: string | null;
  studentIds: string[];
  identityCount: number;
  unscoped: boolean;
};

export function resolveMobileStudentScope(input: {
  role?: string | null;
  selectedStudentId?: string | null;
  children?: SessionChildRef[] | null;
  linkedStudent?: LinkedStudentRef | null;
  user?: SessionUserRef;
}): MobileStudentScope {
  const role = input.role ?? null;
  if (role === "student") {
    const studentIds = sessionStudentAliasKeys(input);
    return { role, studentIds, identityCount: studentIds.length ? 1 : 0, unscoped: false };
  }
  if (role === "parent_student") {
    const studentIds = sessionStudentAliasKeys(input);
    const children = input.children ?? input.user?.children ?? [];
    const identityCount = uniqueNonEmpty(children.map((child) => child.id)).length;
    return { role, studentIds, identityCount, unscoped: false };
  }
  return { role, studentIds: [], identityCount: 0, unscoped: true };
}

export function filterRowsByStudentScope<T extends StudentIdentityRow>(
  rows: T[],
  scope: MobileStudentScope,
): T[] {
  if (scope.unscoped) return rows;
  if (!scope.studentIds.length) return [];
  const allowed = new Set(scope.studentIds);
  return rows.filter((row) => studentRecordAliasKeys(row).some((key) => allowed.has(key)));
}
