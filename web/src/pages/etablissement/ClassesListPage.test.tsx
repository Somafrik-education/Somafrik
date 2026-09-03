import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { School, SessionUser } from "../../types";
import { COUNTRY_ADMIN_ROLE, SCHOOL_ADMIN_ROLE, SUPER_ADMIN_ROLE } from "../../lib/orgHierarchy";

const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LOGIN_A = "CD-IN-26-001";
const LEFTOVER_A = "CD-2026-0001";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

const classesApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const apiGetMock = vi.hoisted(() => vi.fn());
const academicYearsApiMock = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), update: vi.fn() }));

const sessionStore = vi.hoisted(() => ({
  user: {
    id: "u1",
    role: "Admin School",
    schoolCode: "CD-2026-0001",
    schoolPublicCode: "CD-IN-26-001",
    schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "Admin",
  } as SessionUser,
}));

const schoolStore = vi.hoisted(() => ({
  activeSchoolCode: "CD-2026-0001",
  activeSchool: {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    code: "CD-2026-0001",
    publicId: "CD-IN-26-001",
    name: "Institut Nuru",
  } as School,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: sessionStore.user,
    },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: schoolStore.activeSchoolCode,
    activeSchool: schoolStore.activeSchool,
    scopedUser: sessionStore.user,
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: sessionStore.user }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    getEntityFeaturePermissions: () => ({ ...permissions }),
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

vi.mock("../../lib/classesApi", () => ({
  classesApi: classesApiMock,
}));

vi.mock("../../lib/academicYearsApi", () => ({ academicYearsApi: academicYearsApiMock }));

const educationReferenceApiMock = vi.hoisted(() => ({
  getSchoolCatalog: vi.fn(),
}));

vi.mock("../../lib/educationReferenceApi", () => ({
  educationReferenceApi: educationReferenceApiMock,
}));

vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.status = status;
    }
  },
  api: {
    get: apiGetMock,
    post: vi.fn(),
    patch: vi.fn(),
  },
}));

import {
  ClassesListPage,
  chooseLabeledOption,
  composeClassPreviewName,
  getClassDisplayName,
} from "./ClassesListPage";

function renderPage() {
  return render(
    <MemoryRouter>
      <ClassesListPage />
    </MemoryRouter>,
  );
}

function defaultCatalog(overrides: Record<string, unknown> = {}) {
  return {
    schoolCode: LOGIN_A,
    countryCode: "CD",
    labels: { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Groupe" },
    levels: [{ id: "level-4", name: "4ème", schoolActive: true, code: "4eme", displayOrder: 1, status: "active" }],
    streams: [],
    groups: [
      { id: "group-c", name: "C", code: "C", schoolActive: true, displayOrder: 1, status: "active", countryCode: "CD" },
    ],
    ...overrides,
  };
}

describe("ClassesListPage helpers — série métier vs code technique", () => {
  it("conserve la série A/B/C dans le nom pédagogique", () => {
    expect(getClassDisplayName({ name: "6ème Primaire A", groupCode: "A" })).toBe("6ème Primaire A");
    expect(getClassDisplayName({ name: "6ème A", groupCode: "A" })).toBe("6ème A");
    expect(getClassDisplayName({ name: "5ème B", groupCode: "B" })).toBe("5ème B");
    expect(getClassDisplayName({ name: "6ème", groupCode: "A" })).toBe("6ème");
  });

  it("retire uniquement un suffixe technique legacy", () => {
    expect(getClassDisplayName({ name: "1ère A CD02", groupCode: "CD02" })).toBe("1ère A");
    expect(getClassDisplayName({ name: "Primaire Générale CD02", groupCode: "CD02" })).toBe("Primaire Générale");
    expect(getClassDisplayName({ name: "6ème Primaire", groupCode: "CD02" })).toBe("6ème Primaire");
  });

  it("compose Niveau + Filière + Série pour l'aperçu", () => {
    expect(composeClassPreviewName({ levelName: "1ère Primaire", groupCode: "A" })).toBe("1ère Primaire A");
    expect(composeClassPreviewName({ levelName: "6ème Primaire", groupCode: "B" })).toBe("6ème Primaire B");
    expect(
      composeClassPreviewName({
        levelName: "1ère Humanité",
        streamName: "Scientifique",
        groupCode: "A",
      }),
    ).toBe("1ère Humanité Scientifique A");
    expect(
      composeClassPreviewName({
        levelName: "2ème Humanité",
        streamName: "Commerciale et Gestion",
        groupCode: "B",
      }),
    ).toBe("2ème Humanité Commerciale et Gestion B");
    expect(composeClassPreviewName({ levelName: "1ère Primaire", groupCode: "CD02" })).toBe("1ère Primaire");
  });

  it("accorde l'article français du placeholder sans hardcoder le pays", () => {
    expect(chooseLabeledOption("Série")).toBe("Choisir une série");
    expect(chooseLabeledOption("Groupe")).toBe("Choisir un groupe");
    expect(chooseLabeledOption("Niveau")).toBe("Choisir un niveau");
    expect(chooseLabeledOption("Filière")).toBe("Choisir une filière");
  });
});

describe("ClassesListPage — contrat source leftover", () => {
  const page = readFileSync(resolve(__dirname, "./ClassesListPage.tsx"), "utf8");

  it("réutilise scopeAcademicYearsForConfiguration et n'autorise pas leftover schoolCode", () => {
    expect(page).toMatch(/scopeAcademicYearsForConfiguration/);
    expect(page).not.toMatch(/year\.schoolCode\s*===\s*activeSchoolCode/);
    expect(page).not.toMatch(/country\s*===\s*["']CD["']/);
    expect(page).not.toMatch(/backoffice_state/);
  });
});

describe("ClassesListPage (CRUD /api/classes)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    sessionStore.user = {
      id: "u1",
      role: SCHOOL_ADMIN_ROLE,
      schoolCode: LEFTOVER_A,
      schoolPublicCode: LOGIN_A,
      schoolId: SCHOOL_ID_A,
      name: "Admin",
    };
    schoolStore.activeSchoolCode = LEFTOVER_A;
    schoolStore.activeSchool = {
      id: SCHOOL_ID_A,
      code: LEFTOVER_A,
      publicId: LOGIN_A,
      name: "Institut Nuru",
    };
    classesApiMock.list.mockResolvedValue([
      {
        id: "CLS-1",
        publicId: "CLS-1",
        classCode: "CLS-1",
        name: "6ème A",
        level: "6ème",
        section: "A",
        track: "",
        groupCode: "A",
        status: "active",
        schoolCode: LOGIN_A,
        academicYearId: "ay-1",
        academicYearName: "2025-2026",
        schoolYear: "2025-2026",
        students: 2,
      },
      {
        id: "CLS-2",
        publicId: "CLS-2",
        classCode: "CLS-2",
        name: "5ème B",
        level: "5ème",
        section: "B",
        track: "",
        groupCode: "B",
        status: "active",
        schoolCode: LOGIN_A,
        academicYearId: "ay-1",
        academicYearName: "2025-2026",
        schoolYear: "2025-2026",
        students: 0,
      },
    ]);
    classesApiMock.create.mockReset();
    classesApiMock.update.mockReset();
    academicYearsApiMock.list.mockResolvedValue([
      {
        id: "ay-1",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2025-2026",
        isCurrent: true,
      },
    ]);
    educationReferenceApiMock.getSchoolCatalog.mockResolvedValue(defaultCatalog());
    academicYearsApiMock.create.mockReset();
    academicYearsApiMock.update.mockReset();
  });

  it("rend le chrome D2.7 et conserve la série dans la liste", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Classes" })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toBeInTheDocument();
    expect(screen.getByLabelText("Liste")).toBeInTheDocument();
    expect(await screen.findByText("6ème A")).toBeInTheDocument();
    expect(screen.getByText("5ème B")).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
  });

  it("filtre la liste via EntityListSearch", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("6ème A");
    const search = screen.getByRole("searchbox", { name: /Rechercher dans classes/i });
    await user.type(search, "6ème");
    expect(screen.getByText("6ème A")).toBeInTheDocument();
    expect(screen.queryByText("5ème B")).not.toBeInTheDocument();
  });

  it("affiche EmptyState lorsque l'API renvoie une liste vide", async () => {
    classesApiMock.list.mockResolvedValueOnce([]);
    renderPage();
    const empty = await screen.findByRole("status");
    expect(empty).toHaveTextContent("Liste vide");
    expect(empty).toHaveTextContent("Aucun élément à afficher dans classes.");
  });

  it("affiche ForbiddenState si accès refusé", () => {
    permissions.canRead = false;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.queryByRole("heading", { name: "Classes" })).not.toBeInTheDocument();
  });

  it("crée une classe via POST /api/classes", async () => {
    const user = userEvent.setup();
    classesApiMock.create.mockResolvedValue({
      id: "CLS-NEW",
      publicId: "CLS-NEW",
      classCode: "CLS-NEW",
      name: "4ème C",
      level: "4ème",
      section: "C",
      track: "",
      groupCode: "C",
      groupId: "group-c",
      status: "active",
      schoolCode: LOGIN_A,
      academicYearId: "ay-1",
      academicYearName: "2025-2026",
      schoolYear: "2025-2026",
      students: 0,
    });

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.selectOptions(screen.getByLabelText(/Année scolaire/i), "ay-1");
    await user.selectOptions(screen.getByLabelText(/^Niveau/i), "level-4");
    await user.selectOptions(screen.getByLabelText(/^Groupe/i), "group-c");
    await user.click(screen.getByRole("button", { name: "Enregistrer" }));

    await waitFor(() => {
      expect(classesApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          academicYearId: "ay-1",
          levelId: "level-4",
          groupId: "group-c",
          status: "active",
        }),
      );
    });
    expect(await screen.findByText("4ème C")).toBeInTheDocument();
    expect(screen.getByText("C")).toBeInTheDocument();
  });

  it("garde l'année canonique si le schoolCode session leftover diffère du login_code projeté", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.list.mockResolvedValueOnce([
      {
        id: "ay-2026",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2026-2027",
        isCurrent: true,
      },
    ]);

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));

    expect(screen.queryByText(/Aucune année scolaire n'est configurée/)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Année scolaire/i)).toHaveValue("ay-2026");
    expect(screen.getByRole("option", { name: "2026-2027" })).toBeInTheDocument();
  });

  it("présélectionne l'année isCurrent=true", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.list.mockResolvedValueOnce([
      {
        id: "ay-prev",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2025-2026",
        isCurrent: false,
      },
      {
        id: "ay-current",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2026-2027",
        isCurrent: true,
      },
    ]);

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByLabelText(/Année scolaire/i)).toHaveValue("ay-current");
  });

  it("masque l'année d'un autre établissement", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.list.mockResolvedValueOnce([
      {
        id: "ay-foreign",
        schoolId: SCHOOL_ID_B,
        schoolCode: "BI-EC-26-001",
        name: "2026-2027",
        isCurrent: true,
      },
    ]);

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText(/Aucune année scolaire n'est configurée/)).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "2026-2027" })).not.toBeInTheDocument();
  });

  it("Superadmin / Admin Pays sans schoolId cible → fail-closed", async () => {
    const user = userEvent.setup();
    sessionStore.user = {
      ...sessionStore.user,
      role: SUPER_ADMIN_ROLE,
      schoolId: "",
    };
    schoolStore.activeSchool = {
      code: LEFTOVER_A,
      publicId: LOGIN_A,
      name: "Institut Nuru",
    };
    academicYearsApiMock.list.mockResolvedValueOnce([
      {
        id: "ay-2026",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2026-2027",
        isCurrent: true,
      },
    ]);

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText(/Aucune année scolaire n'est configurée/)).toBeInTheDocument();
  });

  it("Admin Pays avec schoolId sélectionné : année visible, leftover ignoré", async () => {
    const user = userEvent.setup();
    sessionStore.user = {
      ...sessionStore.user,
      role: COUNTRY_ADMIN_ROLE,
      schoolId: "",
    };
    schoolStore.activeSchool = {
      id: SCHOOL_ID_A,
      code: LEFTOVER_A,
      publicId: LOGIN_A,
      name: "Institut Nuru",
    };
    academicYearsApiMock.list.mockResolvedValueOnce([
      {
        id: "ay-2026",
        schoolId: SCHOOL_ID_A,
        schoolCode: LOGIN_A,
        name: "2026-2027",
        isCurrent: true,
      },
      {
        id: "ay-foreign",
        schoolId: SCHOOL_ID_B,
        schoolCode: "BI-EC-26-001",
        name: "2025-2026",
        isCurrent: false,
      },
    ]);

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.queryByText(/Aucune année scolaire n'est configurée/)).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "2026-2027" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "2025-2026" })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/Année scolaire/i)).toHaveValue("ay-2026");
  });

  it("oriente vers Paramètres quand aucune année n'est configurée", async () => {
    const user = userEvent.setup();
    academicYearsApiMock.list.mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByText(/Aucune année scolaire n'est configurée/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Créer cette année scolaire" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Paramètres → Année scolaire/ })).toHaveAttribute(
      "href",
      "/parametres/annee-scolaire",
    );
    expect(screen.getByRole("button", { name: "Enregistrer" })).toBeDisabled();
    expect(academicYearsApiMock.create).not.toHaveBeenCalled();
  });

  it("affiche Série lorsque groupLabel pays = Série", async () => {
    const user = userEvent.setup();
    educationReferenceApiMock.getSchoolCatalog.mockResolvedValueOnce(
      defaultCatalog({
        labels: { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Série" },
      }),
    );

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    expect(screen.getByLabelText(/^Série/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Choisir une série" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Choisir un groupe" })).not.toBeInTheDocument();
  });

  it("aperçu Nom généré : 1ère Primaire + Série A", async () => {
    const user = userEvent.setup();
    educationReferenceApiMock.getSchoolCatalog.mockResolvedValueOnce(
      defaultCatalog({
        labels: { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Série" },
        levels: [
          {
            id: "level-1p",
            name: "1ère Primaire",
            schoolActive: true,
            code: "1p",
            displayOrder: 1,
            status: "active",
          },
        ],
        groups: [
          {
            id: "group-a",
            name: "A",
            code: "A",
            schoolActive: true,
            displayOrder: 1,
            status: "active",
            countryCode: "CD",
          },
        ],
      }),
    );

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.selectOptions(screen.getByLabelText(/^Niveau/i), "level-1p");
    expect(screen.getByText("Nom généré : 1ère Primaire A")).toBeInTheDocument();
  });

  it("aperçu Nom généré : Niveau + Filière + Série", async () => {
    const user = userEvent.setup();
    educationReferenceApiMock.getSchoolCatalog.mockResolvedValueOnce(
      defaultCatalog({
        labels: { levelLabel: "Niveau", trackLabel: "Filière", groupLabel: "Série" },
        levels: [
          {
            id: "level-1h",
            name: "1ère Humanité",
            schoolActive: true,
            code: "1h",
            displayOrder: 1,
            status: "active",
          },
        ],
        streams: [
          {
            id: "stream-sci",
            name: "Scientifique",
            schoolActive: true,
            code: "sci",
            displayOrder: 1,
            status: "active",
            levelId: "level-1h",
          },
        ],
        groups: [
          {
            id: "group-a",
            name: "A",
            code: "A",
            schoolActive: true,
            displayOrder: 1,
            status: "active",
            countryCode: "CD",
          },
        ],
      }),
    );

    renderPage();
    await screen.findByText("6ème A");
    await user.click(screen.getByRole("button", { name: "Ajouter" }));
    await user.selectOptions(screen.getByLabelText(/^Niveau/i), "level-1h");
    await user.selectOptions(screen.getByLabelText(/^Filière/i), "stream-sci");
    expect(screen.getByText("Nom généré : 1ère Humanité Scientifique A")).toBeInTheDocument();
  });
});
