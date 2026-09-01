import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { AcademicYear } from "../lib/academicYearsApi";
import type { School, SessionUser } from "../types";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const yearPermissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const academicYearsApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

const sessionStore = vi.hoisted(() => ({
  user: {
    id: "admin-nuru",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Admin Nuru",
  } as SessionUser,
}));

const schoolStore = vi.hoisted(() => ({
  activeSchoolCode: "CD-2026-0001",
  activeSchool: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "CD-2026-0001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
    city: "Kinshasa",
  } as School,
  availableSchools: [
    {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      code: "CD-2026-0001",
      publicId: "CD-IN-26-001",
      name: "Institut Nuru",
      city: "Kinshasa",
    },
  ] as School[],
}));

function existingYear(overrides: Partial<AcademicYear> = {}): AcademicYear {
  return {
    id: "ay-nuru-2026",
    schoolId: SCHOOL_ID_A,
    schoolCode: LOGIN_A,
    name: "2026-2027",
    startDate: "2026-10-01",
    endDate: "2027-07-31",
    status: "Ouverte",
    isCurrent: true,
    ...overrides,
  };
}

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: sessionStore.user },
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: {
      academicConfigs: {
        [LEFTOVER_A]: { periodMode: "trimestre", periods: [], defaultScale: 20 },
      },
    },
    invalidateDomains: vi.fn(),
    ensureDomains: vi.fn(),
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: schoolStore.activeSchoolCode,
    activeSchool: schoolStore.activeSchool,
    availableSchools: schoolStore.availableSchools,
    requiresSelection: false,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: sessionStore.user }),
  useFeaturePermissions: (feature: string) => {
    if (feature === "Années Académiques") return { ...yearPermissions };
    return { canRead: true, canCreate: true, canUpdate: true, canDelete: false };
  },
}));

vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/permissions")>();
  return {
    ...actual,
    canAccessSchoolBackOffice: () => true,
    canManageEstablishmentSettings: () => true,
  };
});

vi.mock("../lib/academicYearsApi", () => ({ academicYearsApi: academicYearsApiMock }));

vi.mock("../lib/schoolSettingsApi", () => ({
  schoolSettingsApi: { patch: vi.fn(), replacePeriods: vi.fn() },
}));

vi.mock("../lib/establishmentRolesApi", () => ({
  establishmentRolesApi: { listAssignable: vi.fn().mockResolvedValue({ roles: [] }) },
}));

vi.mock("../design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../design-system")>();
  return {
    ...actual,
    useToast: () => ({ showToast }),
  };
});

import { ConfigurationPage } from "./ConfigurationPage";

describe("ConfigurationPage — scope canonique années scolaires", () => {
  beforeEach(() => {
    yearPermissions.canRead = true;
    yearPermissions.canCreate = true;
    yearPermissions.canUpdate = true;
    academicYearsApiMock.list.mockReset();
    academicYearsApiMock.create.mockReset();
    academicYearsApiMock.update.mockReset();
    showToast.mockReset();
    sessionStore.user = {
      id: "admin-nuru",
      role: "Admin School",
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
      name: "Admin Nuru",
    } as SessionUser;
    schoolStore.activeSchoolCode = LEFTOVER_A;
    schoolStore.activeSchool = {
      id: SCHOOL_ID_A,
      code: LEFTOVER_A,
      publicId: LOGIN_A,
      name: "Institut Nuru",
      city: "Kinshasa",
    };
    schoolStore.availableSchools = [schoolStore.activeSchool];
  });

  it("school_code leftover + login_code V2 + année existante → année visible", async () => {
    academicYearsApiMock.list.mockResolvedValue([existingYear()]);

    render(
      <MemoryRouter>
        <ConfigurationPage section="annee-scolaire" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("2026-2027")).toBeInTheDocument();
    expect(screen.getByText("Année courante")).toBeInTheDocument();
    expect(screen.queryByText(/Aucune année configurée/)).not.toBeInTheDocument();
    expect(academicYearsApiMock.list).toHaveBeenCalled();
  });

  it("reloadAcademicYears conserve l'année login_code malgré leftover configTarget", async () => {
    const user = userEvent.setup();
    const current = existingYear({ isCurrent: false, status: "Ouverte" });
    academicYearsApiMock.list
      .mockResolvedValueOnce([current])
      .mockResolvedValue([existingYear({ isCurrent: true })]);
    academicYearsApiMock.update.mockResolvedValue(existingYear({ isCurrent: true }));

    render(
      <MemoryRouter>
        <ConfigurationPage section="annee-scolaire" />
      </MemoryRouter>,
    );

    expect(await screen.findByText("2026-2027")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Définir comme courante" }));

    await waitFor(() => {
      expect(academicYearsApiMock.update).toHaveBeenCalled();
      expect(academicYearsApiMock.list).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByText("Année courante")).toBeInTheDocument();
    expect(screen.queryByText(/Aucune année configurée/)).not.toBeInTheDocument();
  });
});
