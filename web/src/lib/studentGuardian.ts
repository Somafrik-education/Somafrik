import type {
  Guardian,
  Person,
  Student,
  StudentGuardianRelation,
} from "./studentDomain";
import { parseCivilDate } from "./studentWorkspaceDates";

export type GuardianRelationshipType =
  | "FATHER"
  | "MOTHER"
  | "LEGAL_GUARDIAN"
  | "TUTOR"
  | "GRANDPARENT"
  | "UNCLE_AUNT"
  | "BROTHER_SISTER"
  | "OTHER";

export const GUARDIAN_RELATIONSHIP_TYPES = [
  "FATHER",
  "MOTHER",
  "LEGAL_GUARDIAN",
  "TUTOR",
  "GRANDPARENT",
  "UNCLE_AUNT",
  "BROTHER_SISTER",
  "OTHER",
] as const satisfies readonly GuardianRelationshipType[];

const RELATIONSHIP_LABELS: Record<GuardianRelationshipType, string> = {
  FATHER: "Père",
  MOTHER: "Mère",
  LEGAL_GUARDIAN: "Représentant légal",
  TUTOR: "Tuteur",
  GRANDPARENT: "Grand-parent",
  UNCLE_AUNT: "Oncle / Tante",
  BROTHER_SISTER: "Frère / Sœur",
  OTHER: "Autre",
};

const RELATIONSHIP_ALIASES: Record<string, GuardianRelationshipType> = {
  father: "FATHER",
  papa: "FATHER",
  pere: "FATHER",
  "père": "FATHER",
  dad: "FATHER",

  mother: "MOTHER",
  maman: "MOTHER",
  mere: "MOTHER",
  "mère": "MOTHER",
  mom: "MOTHER",

  "legal guardian": "LEGAL_GUARDIAN",
  legal_guardian: "LEGAL_GUARDIAN",
  "representant legal": "LEGAL_GUARDIAN",
  "représentant légal": "LEGAL_GUARDIAN",
  representant: "LEGAL_GUARDIAN",

  tutor: "TUTOR",
  tuteur: "TUTOR",
  tutrice: "TUTOR",

  grandparent: "GRANDPARENT",
  "grand-parent": "GRANDPARENT",
  grandpere: "GRANDPARENT",
  "grand-père": "GRANDPARENT",
  grandmere: "GRANDPARENT",
  "grand-mère": "GRANDPARENT",

  uncle: "UNCLE_AUNT",
  aunt: "UNCLE_AUNT",
  oncle: "UNCLE_AUNT",
  tante: "UNCLE_AUNT",
  "uncle_aunt": "UNCLE_AUNT",
  "oncle / tante": "UNCLE_AUNT",

  brother: "BROTHER_SISTER",
  sister: "BROTHER_SISTER",
  frere: "BROTHER_SISTER",
  "frère": "BROTHER_SISTER",
  soeur: "BROTHER_SISTER",
  "sœur": "BROTHER_SISTER",
  "brother_sister": "BROTHER_SISTER",

  other: "OTHER",
  autre: "OTHER",
};

export type FutureStudentGuardianPermission =
  | "student.guardians.read"
  | "student.guardians.create"
  | "student.guardians.update"
  | "student.guardians.delete";

export const FUTURE_STUDENT_GUARDIAN_PERMISSIONS: readonly FutureStudentGuardianPermission[] =
  [
    "student.guardians.read",
    "student.guardians.create",
    "student.guardians.update",
    "student.guardians.delete",
  ];

/**
 * Relation métier élève ↔ responsable (C1.3).
 * Les règles (légal, urgence, pickup, finance) vivent ici, pas dans l'UI.
 */
export interface StudentGuardianRelationRecord {
  id: string;
  studentId: string;
  guardianId: string;

  relationshipType: GuardianRelationshipType;

  isLegalGuardian: boolean;
  livesWithStudent: boolean;
  isEmergencyContact: boolean;
  pickupAuthorized: boolean;
  financialResponsible: boolean;

  priority: number;

  startDate: string | null;
  endDate: string | null;
  notes: string | null;

  displayName: string;
  phone: string | null;
  email: string | null;
  address: string | null;

  isActive: boolean;
  isExpired: boolean;
}

function normalizeOptional(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function repairMojibake(value: string): string {
  return value
    .replace(/Ã©/g, "é")
    .replace(/Ã¨/g, "è")
    .replace(/Ãª/g, "ê")
    .replace(/Ã /g, "à")
    .replace(/Ã§/g, "ç")
    .replace(/Ã´/g, "ô")
    .replace(/Å"/g, "œ")
    .replace(/Å“/g, "œ");
}

function foldKey(value: string): string {
  return repairMojibake(value)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

export function isGuardianRelationshipType(
  value: unknown,
): value is GuardianRelationshipType {
  return (
    typeof value === "string" &&
    (GUARDIAN_RELATIONSHIP_TYPES as readonly string[]).includes(value)
  );
}

export function normalizeGuardianRelationshipType(
  value: unknown,
): GuardianRelationshipType {
  if (isGuardianRelationshipType(value)) {
    return value;
  }

  const raw = String(value ?? "").trim();
  if (!raw) return "OTHER";

  const folded = foldKey(raw);
  if (folded in RELATIONSHIP_ALIASES) {
    return RELATIONSHIP_ALIASES[folded];
  }

  if (folded.includes("pere") || folded.includes("papa") || folded.includes("father")) {
    return "FATHER";
  }
  if (folded.includes("mere") || folded.includes("maman") || folded.includes("mother")) {
    return "MOTHER";
  }
  if (folded.includes("tuteur") || folded.includes("tutor")) {
    return "TUTOR";
  }
  if (folded.includes("representant") || folded.includes("legal")) {
    return "LEGAL_GUARDIAN";
  }
  if (folded.includes("grand")) {
    return "GRANDPARENT";
  }
  if (folded.includes("oncle") || folded.includes("tante") || folded.includes("uncle") || folded.includes("aunt")) {
    return "UNCLE_AUNT";
  }
  if (folded.includes("frere") || folded.includes("soeur") || folded.includes("brother") || folded.includes("sister")) {
    return "BROTHER_SISTER";
  }

  return "OTHER";
}

export function getGuardianRelationshipLabel(
  type: GuardianRelationshipType,
): string {
  return RELATIONSHIP_LABELS[type];
}

export function listGuardianRelationshipLabels(): Record<
  GuardianRelationshipType,
  string
> {
  return { ...RELATIONSHIP_LABELS };
}

function buildPersonDisplayName(person?: Person | null): string {
  if (!person) return "";
  return [person.lastName, person.firstName, person.middleName]
    .map((part) => String(part ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

export function isGuardianRelationExpired(
  endDate: string | null | undefined,
  referenceDate: Date = new Date(),
): boolean {
  if (!endDate?.trim()) return false;
  const parsed = parseCivilDate(endDate);
  if (!parsed) return false;

  const today = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth(),
    referenceDate.getDate(),
  );
  return parsed.getTime() < today.getTime();
}

export function toStudentGuardianRelationRecord(
  relation: StudentGuardianRelation,
  options: {
    guardian?: Guardian | null;
    person?: Person | null;
    referenceDate?: Date;
  } = {},
): StudentGuardianRelationRecord {
  const raw = relation as StudentGuardianRelation & {
    livesWithStudent?: boolean;
    financialResponsible?: boolean;
    pickupAuthorized?: boolean;
  };

  const endDate = normalizeOptional(relation.endDate);
  const isExpired = isGuardianRelationExpired(endDate, options.referenceDate);
  const isInactive = relation.status === "Inactif";
  const displayName = buildPersonDisplayName(options.person);

  return {
    id: relation.id,
    studentId: relation.studentId,
    guardianId: relation.guardianId,
    relationshipType: normalizeGuardianRelationshipType(
      relation.relationshipType,
    ),
    isLegalGuardian: Boolean(relation.isLegalGuardian),
    livesWithStudent: Boolean(raw.livesWithStudent),
    isEmergencyContact: Boolean(relation.isEmergencyContact),
    pickupAuthorized: Boolean(
      raw.pickupAuthorized ?? relation.canPickUpStudent,
    ),
    financialResponsible: Boolean(
      raw.financialResponsible ?? relation.isFinanciallyResponsible,
    ),
    priority:
      typeof relation.priority === "number" && Number.isFinite(relation.priority)
        ? relation.priority
        : 999,
    startDate: normalizeOptional(relation.startDate),
    endDate,
    notes: normalizeOptional(relation.notes),
    displayName: displayName || "Responsable",
    phone: normalizeOptional(options.person?.phone),
    email: normalizeOptional(options.person?.email),
    address: normalizeOptional(options.person?.address),
    isActive: !isInactive && !isExpired,
    isExpired,
  };
}

/**
 * Pont legacy : parentName / parentPhone sur la fiche élève
 * lorsque aucune relation structurée n'existe.
 */
export function deriveGuardiansFromLegacyStudent(
  student: Student,
): StudentGuardianRelationRecord[] {
  const parentName = normalizeOptional(student.parentName);
  const parentPhone = normalizeOptional(student.parentPhone);
  if (!parentName && !parentPhone) {
    return [];
  }

  return [
    {
      id: `LEGACY-GUARDIAN-${student.id}`,
      studentId: student.id,
      guardianId: `LEGACY-G-${student.id}`,
      relationshipType: "OTHER",
      isLegalGuardian: true,
      livesWithStudent: false,
      isEmergencyContact: true,
      pickupAuthorized: true,
      financialResponsible: true,
      priority: 1,
      startDate: null,
      endDate: null,
      notes: "Relation dérivée des champs legacy parentName / parentPhone",
      displayName: parentName ?? "Responsable",
      phone: parentPhone,
      email: null,
      address: null,
      isActive: true,
      isExpired: false,
    },
  ];
}

export function collectStudentGuardianRelationRecords(input: {
  student: Student;
  guardians?: readonly Guardian[];
  guardianRelations?: readonly StudentGuardianRelation[];
  persons?: readonly Person[];
  referenceDate?: Date;
}): StudentGuardianRelationRecord[] {
  const {
    student,
    guardians = [],
    guardianRelations = [],
    persons = [],
    referenceDate,
  } = input;

  const forStudent = guardianRelations.filter(
    (relation) => relation.studentId === student.id,
  );

  if (forStudent.length === 0) {
    return deriveGuardiansFromLegacyStudent(student);
  }

  return forStudent.map((relation) => {
    const guardian = guardians.find(
      (candidate) => candidate.id === relation.guardianId,
    );
    const person = guardian?.personId
      ? persons.find((candidate) => candidate.id === guardian.personId)
      : undefined;
    return toStudentGuardianRelationRecord(relation, {
      guardian,
      person,
      referenceDate,
    });
  });
}
