import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { EditableStudentIdentity } from "./studentEditing";
import type { StudentWorkspaceCommandRepository } from "./studentEditingRepository";
import type { SchoolStudent } from "./studentsApi";

vi.mock("../api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api/client")>();
  return { ...actual };
});

const updateMock = vi.hoisted(() => vi.fn());

vi.mock("./studentsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./studentsApi")>();
  return {
    ...actual,
    studentsApi: {
      ...actual.studentsApi,
      update: updateMock,
    },
  };
});

import {
  buildIdentityPatchPayload,
  isPersistableIdentityPatchField,
  toSchoolStudentApiGender,
  wrapRepositoryWithHttpIdentity,
} from "./studentIdentityHttp";
import { toEditableStudentIdentity, toEditableStudentIdentityFromDossier } from "./studentEditingAdapters";

const UPDATED_AT = "2026-09-30T12:00:00.000Z";

function identity(overrides: Partial<EditableStudentIdentity> = {}): EditableStudentIdentity {
  return {
    studentId: "CD-ITR-AS-26-00004",
    schoolCode: "CD-ITR-26-001",
    matricule: "CD-ITR-AS-26-00004",
    version: 4,
    updatedAt: UPDATED_AT,
    firstName: "Amina",
    lastName: "Diallo",
    preferredName: null,
    gender: "F",
    birthDate: "2014-01-01",
    birthPlace: "Kinshasa",
    nationality: null,
    address: null,
    phone: "+243800000001",
    email: "parent@test.local",
    ...overrides,
  };
}

function dossier(overrides: Partial<SchoolStudent> = {}): SchoolStudent {
  return {
    id: "CD-ITR-AS-26-00004",
    publicId: "CD-ITR-AS-26-00004",
    studentCode: "CD-ITR-AS-26-00004",
    matricule: "CD-ITR-AS-26-00004",
    firstName: "Amina",
    lastName: "Diallo",
    name: "Amina Diallo",
    gender: "Féminin",
    birthDate: "01-01-2014",
    birthPlace: "Kinshasa",
    className: "6ème A",
    classCode: "CLS-6A",
    schoolCode: "CD-ITR-26-001",
    parentPhone: "+243800000001",
    parentEmail: "parent@test.local",
    status: "active",
    enrollmentId: "enr-1",
    enrollmentDate: "01-09-2026",
    academicYearName: "2026-2027",
    updatedAt: UPDATED_AT,
    ...overrides,
  };
}

function stubBase(
  current: EditableStudentIdentity | null,
): StudentWorkspaceCommandRepository {
  return {
    getStudentIdentity: async () => current,
    getGuardianContact: async () => null,
    listGuardianContacts: async () => [],
    getAdministrativeDetails: async () => null,
    getEnrollment: async () => null,
    listSchoolClasses: async () => [],
    updateStudentIdentity: async () => {
      throw new Error("mock updateStudentIdentity must not run");
    },
    updateGuardianContact: async () => {
      throw new Error("unused");
    },
    updateAdministrativeDetails: async () => {
      throw new Error("unused");
    },
    validateEnrollment: async () => {
      throw new Error("unused");
    },
    assignEnrollmentClass: async () => {
      throw new Error("unused");
    },
    transferEnrollment: async () => {
      throw new Error("unused");
    },
    closeEnrollment: async () => {
      throw new Error("unused");
    },
  };
}

describe("studentIdentityHttp — PATCH PostgreSQL", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("mappe téléphone/e-mail vers parentPhone/parentEmail et impose expectedUpdatedAt", () => {
    const built = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { phone: "+243811111111", email: "nouveau@test.local" },
      },
      identity(),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toEqual({
      expectedUpdatedAt: UPDATED_AT,
      parentPhone: "+243811111111",
      parentEmail: "nouveau@test.local",
    });
    expect(built.payload).not.toHaveProperty("phone");
    expect(built.payload).not.toHaveProperty("email");
  });

  it("mappe le sexe UI vers le contrat PATCH Masculin/Féminin/Autre", () => {
    expect(toSchoolStudentApiGender("F")).toBe("Féminin");
    expect(toSchoolStudentApiGender("M")).toBe("Masculin");
    expect(toSchoolStudentApiGender("OTHER")).toBe("Autre");
    expect(toSchoolStudentApiGender("UNKNOWN")).toBeNull();
  });

  it("envoie birthDate en YYYY-MM-DD", () => {
    const built = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { birthDate: "05-05-2011", gender: "F" },
      },
      identity(),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.birthDate).toBe("2011-05-05");
    expect(built.payload.gender).toBe("Féminin");
  });

  it("refuse un ChangeSet uniquement hors contrat PATCH", () => {
    const built = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { nationality: "CD", address: "Av. 1", preferredName: "Ami" },
      },
      identity(),
    );
    expect(built.ok).toBe(false);
  });

  it("refuse un updatedAt vide (jeton occupancy)", () => {
    const built = buildIdentityPatchPayload(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { firstName: "Awa" },
      },
      identity({ updatedAt: "" }),
    );
    expect(built.ok).toBe(false);
  });

  it("appelle studentsApi.update puis onPersisted", async () => {
    updateMock.mockResolvedValueOnce(
      dossier({ firstName: "Awa", parentPhone: "+243811111111", updatedAt: "2026-09-30T12:01:00.000Z" }),
    );
    const onPersisted = vi.fn(async () => undefined);
    const repo = wrapRepositoryWithHttpIdentity(stubBase(identity()), { onPersisted });
    const result = await repo.updateStudentIdentity(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { firstName: "Awa", phone: "+243811111111" },
      },
      {
        userId: "u-1",
        role: "Secrétaire",
        schoolCode: "CD-ITR-26-001",
        permissions: ["Élèves:UPDATE"],
      },
    );
    expect(updateMock).toHaveBeenCalledWith("CD-ITR-AS-26-00004", {
      expectedUpdatedAt: UPDATED_AT,
      firstName: "Awa",
      parentPhone: "+243811111111",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.updatedAggregate.firstName).toBe("Awa");
      expect(result.updatedAggregate.phone).toBe("+243811111111");
    }
    expect(onPersisted).toHaveBeenCalledTimes(1);
  });

  it("mappe HTTP 409 vers VERSION_CONFLICT", async () => {
    updateMock.mockRejectedValueOnce(
      new ApiError("Conflit de modification", 409),
    );
    const repo = wrapRepositoryWithHttpIdentity(stubBase(identity()));
    const result = await repo.updateStudentIdentity(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { firstName: "Awa" },
      },
      {
        userId: "u-1",
        role: "Secrétaire",
        schoolCode: "CD-ITR-26-001",
        permissions: ["Élèves:UPDATE"],
      },
    );
    expect(result.success).toBe(false);
    if (!result.success) expect(result.code).toBe("VERSION_CONFLICT");
  });

  it("ne délègue pas au mock updateStudentIdentity", async () => {
    updateMock.mockResolvedValueOnce(dossier());
    const base = stubBase(identity());
    const spy = vi.spyOn(base, "updateStudentIdentity");
    const repo = wrapRepositoryWithHttpIdentity(base);
    await repo.updateStudentIdentity(
      {
        type: "UPDATE_STUDENT_IDENTITY",
        studentId: "CD-ITR-AS-26-00004",
        expectedVersion: 4,
        changes: { lastName: "Kone" },
      },
      {
        userId: "u-1",
        role: "Secrétaire",
        schoolCode: "CD-ITR-26-001",
        permissions: ["Élèves:UPDATE"],
      },
    );
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("seed identité depuis GET dossier", () => {
  it("lit parentPhone/parentEmail et updatedAt du dossier", () => {
    const editable = toEditableStudentIdentityFromDossier(dossier());
    expect(editable.phone).toBe("+243800000001");
    expect(editable.email).toBe("parent@test.local");
    expect(editable.updatedAt).toBe(UPDATED_AT);
    expect(editable.birthDate).toBe("2014-01-01");
    expect(editable.gender).toBe("F");
  });

  it("toEditableStudentIdentity lit parentPhone si phone est absent", () => {
    const editable = toEditableStudentIdentity({
      student: {
        id: "CD-ITR-AS-26-00004",
        matricule: "CD-ITR-AS-26-00004",
        schoolCode: "CD-ITR-26-001",
        firstName: "Amina",
        lastName: "Diallo",
        parentPhone: "+243800000009",
        parentEmail: "liste@test.local",
        updatedAt: UPDATED_AT,
      },
    });
    expect(editable.phone).toBe("+243800000009");
    expect(editable.email).toBe("liste@test.local");
  });
});

describe("garde source — studentsApi.update branché", () => {
  it("le wrapper HTTP identité appelle studentsApi.update", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "studentIdentityHttp.ts"), "utf8");
    expect(source).toMatch(/studentsApi\.update\(/);
    expect(isPersistableIdentityPatchField("phone")).toBe(true);
    expect(isPersistableIdentityPatchField("nationality")).toBe(false);
  });

  it("le contexte d'édition enveloppe le repository identité", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../hooks/useStudentEditingContext.ts"),
      "utf8",
    );
    expect(source).toMatch(/wrapRepositoryWithHttpIdentity/);
    expect(source).toMatch(/toEditableStudentIdentityFromDossier/);
  });

  it("le refetch fiche relit GET /api/students sans setLoading", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(
      join(here, "../hooks/useStudentWorkspace.ts"),
      "utf8",
    );
    expect(source).toMatch(/studentsApi\.get\(normalizedStudentId\)/);
    expect(source).toMatch(/const refresh = useCallback\(async/);
    const refreshBlock = source.slice(source.indexOf("const refresh = useCallback"));
    expect(refreshBlock).not.toMatch(/setLoading\(true\)/);
  });
});
