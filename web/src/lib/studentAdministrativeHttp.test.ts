import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { EditableStudentAdministrativeDetails } from "./studentEditing";
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
  buildAdministrativeNotesPatchPayload,
  wrapRepositoryWithHttpAdministrative,
} from "./studentAdministrativeHttp";

const UPDATED_AT = "2026-09-30T12:00:00.000Z";
const STUDENT_CODE = "CD-LAC-EL-26-901";

function details(
  overrides: Partial<EditableStudentAdministrativeDetails> = {},
): EditableStudentAdministrativeDetails {
  return {
    studentId: "ctx-student-1",
    schoolCode: "CD-LAC-26-001",
    version: 2,
    updatedAt: UPDATED_AT,
    administrativeNotes: "ancienne note",
    preferredContactChannel: null,
    ...overrides,
  };
}

function dossier(overrides: Partial<SchoolStudent> = {}): SchoolStudent {
  return {
    id: STUDENT_CODE,
    publicId: STUDENT_CODE,
    studentCode: STUDENT_CODE,
    matricule: STUDENT_CODE,
    firstName: "Amina",
    lastName: "Diallo",
    name: "Amina Diallo",
    gender: "Féminin",
    birthDate: "01-01-2014",
    className: "6ème A",
    classCode: "CLS-6A",
    schoolCode: "CD-LAC-26-001",
    parentPhone: "",
    parentEmail: "",
    status: "active",
    enrollmentId: null,
    enrollmentDate: "",
    academicYearName: "2026-2027",
    updatedAt: "2026-09-30T12:05:00.000Z",
    administrativeNotes: "NOTE-FIXTURE-BETA",
    ...overrides,
  };
}

function stubBase(
  current: EditableStudentAdministrativeDetails | null,
): StudentWorkspaceCommandRepository {
  return {
    getStudentIdentity: async () => null,
    getGuardianContact: async () => null,
    listGuardianContacts: async () => [],
    getAdministrativeDetails: async () => current,
    getEnrollment: async () => null,
    listSchoolClasses: async () => [],
    updateStudentIdentity: async () => {
      throw new Error("identité non concernée");
    },
    updateGuardianContact: async () => {
      throw new Error("unused");
    },
    updateAdministrativeDetails: async () => {
      throw new Error("mock updateAdministrativeDetails must not run");
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

const actor = {
  userId: "user-1",
  role: "Admin School",
  schoolCode: "CD-LAC-26-001",
  permissions: ["Élèves:UPDATE"],
};

describe("studentAdministrativeHttp — payload", () => {
  it("normalise les notes et ignore un canal inchangé", () => {
    const built = buildAdministrativeNotesPatchPayload(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: {
          administrativeNotes: "  nouvelle   note  ",
          preferredContactChannel: null,
        },
      },
      details(),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload).toEqual({
      expectedUpdatedAt: UPDATED_AT,
      administrativeNotes: "nouvelle note",
    });
  });

  it("refuse un changement de canal avant tout appel HTTP", () => {
    const built = buildAdministrativeNotesPatchPayload(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: {
          administrativeNotes: "note",
          preferredContactChannel: "SMS",
        },
      },
      details(),
    );
    expect(built.ok).toBe(false);
  });

  it("efface une note vide", () => {
    const built = buildAdministrativeNotesPatchPayload(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "   " },
      },
      details(),
    );
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.payload.administrativeNotes).toBeNull();
  });
});

describe("studentAdministrativeHttp — persistance", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("confirme le succès seulement après la réponse et le refetch", async () => {
    updateMock.mockResolvedValue(dossier());
    const onPersisted = vi.fn(async () => undefined);
    const repo = wrapRepositoryWithHttpAdministrative(stubBase(details()), {
      studentCode: STUDENT_CODE,
      onPersisted,
    });
    const result = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "NOTE-FIXTURE-BETA" },
      },
      actor,
    );
    expect(updateMock).toHaveBeenCalledWith(STUDENT_CODE, {
      expectedUpdatedAt: UPDATED_AT,
      administrativeNotes: "NOTE-FIXTURE-BETA",
    });
    expect(result.success).toBe(true);
    expect(onPersisted).toHaveBeenCalledOnce();
    if (result.success) {
      expect(result.updatedAggregate.administrativeNotes).toBe("NOTE-FIXTURE-BETA");
    }
  });

  it("ne réussit pas si la réponse ne confirme pas la note", async () => {
    updateMock.mockResolvedValue(dossier({ administrativeNotes: "autre" }));
    const onPersisted = vi.fn();
    const repo = wrapRepositoryWithHttpAdministrative(stubBase(details()), {
      studentCode: STUDENT_CODE,
      onPersisted,
    });
    const result = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "NOTE-FIXTURE-BETA" },
      },
      actor,
    );
    expect(result.success).toBe(false);
    expect(onPersisted).not.toHaveBeenCalled();
  });

  it("une erreur réseau ne produit pas de succès", async () => {
    updateMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const repo = wrapRepositoryWithHttpAdministrative(stubBase(details()), {
      studentCode: STUDENT_CODE,
    });
    const result = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "brouillon conservé" },
      },
      actor,
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.code).toBe("VALIDATION_ERROR");
      expect(result.errors[0]?.message).toMatch(/connexion a échoué/);
    }
  });

  it("mappe 403, 409 et 500 sans succès", async () => {
    const repo = wrapRepositoryWithHttpAdministrative(stubBase(details()), {
      studentCode: STUDENT_CODE,
    });
    updateMock.mockRejectedValueOnce(new ApiError("interdit", 403));
    const denied = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "x" },
      },
      actor,
    );
    expect(denied.success).toBe(false);
    if (!denied.success) expect(denied.code).toBe("PERMISSION_DENIED");

    updateMock.mockRejectedValueOnce(new ApiError("conflit", 409));
    const conflict = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "x" },
      },
      actor,
    );
    expect(conflict.success).toBe(false);
    if (!conflict.success) expect(conflict.code).toBe("VERSION_CONFLICT");

    updateMock.mockRejectedValueOnce(new ApiError("base indisponible", 500));
    const failure = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "x" },
      },
      actor,
    );
    expect(failure.success).toBe(false);
  });

  it("n'appelle pas le mock et exige le code canonique", async () => {
    const repo = wrapRepositoryWithHttpAdministrative(stubBase(details()), {
      studentCode: "",
    });
    const result = await repo.updateAdministrativeDetails(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: "ctx-student-1",
        expectedVersion: 2,
        changes: { administrativeNotes: "x" },
      },
      actor,
    );
    expect(result.success).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });
});

describe("garde source — notes administratives", () => {
  it("le contexte enveloppe le PATCH et relit la valeur du dossier", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const source = readFileSync(join(here, "../hooks/useStudentEditingContext.ts"), "utf8");
    expect(source).toMatch(/wrapRepositoryWithHttpAdministrative/);
    expect(source).toMatch(/dossier\.administrativeNotes/);
    expect(source).toMatch(/studentCode: String\(dossier\?\.studentCode/);
    const panel = readFileSync(
      join(here, "../components/students/editing/StudentEditingPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/if \(result\?\.success\)/);
  });
});
