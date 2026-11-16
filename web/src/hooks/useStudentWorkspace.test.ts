import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/studentsApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/studentsApi")>();
  return {
    ...actual,
    studentsApi: {
      ...actual.studentsApi,
      get: getMock,
    },
  };
});

import { useStudentWorkspace } from "./useStudentWorkspace";
import type { SchoolStudent } from "../lib/studentsApi";

function dossier(firstName = "Amina"): SchoolStudent {
  return {
    id: "CD-ITR-AS-26-00004",
    publicId: "CD-ITR-AS-26-00004",
    studentCode: "CD-ITR-AS-26-00004",
    matricule: "CD-ITR-AS-26-00004",
    firstName,
    lastName: "Diallo",
    name: `${firstName} Diallo`,
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
    updatedAt: "2026-09-30T12:00:00.000Z",
  };
}

describe("useStudentWorkspace — refetch GET silencieux", () => {
  beforeEach(() => {
    getMock.mockReset();
  });

  it("refresh relit GET sans flash loading plein écran", async () => {
    getMock.mockResolvedValueOnce(dossier("Amina"));
    const { result } = renderHook(() =>
      useStudentWorkspace("CD-ITR-AS-26-00004"),
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dossier?.firstName).toBe("Amina");
    expect(result.current.loading).toBe(false);

    getMock.mockResolvedValueOnce(dossier("Awa"));
    await act(async () => {
      await result.current.refresh();
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.dossier?.firstName).toBe("Awa");
    expect(getMock).toHaveBeenCalledTimes(2);
    expect(getMock).toHaveBeenLastCalledWith("CD-ITR-AS-26-00004");
  });
});
