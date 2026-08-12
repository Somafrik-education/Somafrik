import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

const teachersApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "u1",
        role: "Admin School",
        schoolCode: "CD-2026-0001",
        name: "Admin",
      },
    },
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "CD-2026-0001",
    scopedUser: {
      id: "u1",
      role: "Admin School",
      schoolCode: "CD-2026-0001",
      name: "Admin",
    },
  }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({ user: { role: "Admin School", schoolCode: "CD-2026-0001" } }),
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    getEntityFeaturePermissions: () => ({ ...permissions }),
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../lib/teachersApi", () => ({
  teachersApi: teachersApiMock,
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
    get: vi.fn(),
    post: vi.fn(),
  },
}));

import { TeachersListPage } from "./TeachersListPage";
import { ApiError } from "../../api/client";

function renderPage() {
  return render(
    <MemoryRouter>
      <TeachersListPage />
    </MemoryRouter>,
  );
}

describe("TeachersListPage (création compte + fiche)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    teachersApiMock.list.mockReset();
    teachersApiMock.create.mockReset();
    showToast.mockReset();
    teachersApiMock.list.mockResolvedValue([
      {
        id: "CD-2026-0001-ENS-0001",
        teacherCode: "CD-2026-0001-ENS-0001",
        publicId: "CD-2026-0001-ENS-0001",
        identifier: "ENS-0001",
        firstName: "Aïssatou",
        lastName: "Ndiaye",
        name: "Aïssatou Ndiaye",
        phone: "+243 800",
        email: "",
        speciality: "Mathématiques",
        mainSubject: "Mathématiques",
        schoolCode: "CD-2026-0001",
        status: "Actif",
        gender: "",
        birthDate: "",
        entryDate: "",
      },
      {
        id: "CD-2026-0001-ENS-0002",
        teacherCode: "CD-2026-0001-ENS-0002",
        publicId: "CD-2026-0001-ENS-0002",
        identifier: "ENS-0002",
        firstName: "Moussa",
        lastName: "Ba",
        name: "Moussa Ba",
        phone: "",
        email: "moussa@example.com",
        speciality: "Français",
        mainSubject: "Français",
        schoolCode: "CD-2026-0001",
        status: "Actif",
        gender: "",
        birthDate: "",
        entryDate: "",
      },
    ]);
  });

  it("charge la liste via l'API métier", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 2, name: "Enseignants" })).toBeInTheDocument();
    expect(await screen.findByText("Ndiaye")).toBeInTheDocument();
    expect(screen.getByText("Ba")).toBeInTheDocument();
    expect(teachersApiMock.list).toHaveBeenCalled();
  });

  it("crée un enseignant puis recharge la liste", async () => {
    const user = userEvent.setup();
    teachersApiMock.create.mockResolvedValue({
      teacherCode: "CD-2026-0001-ENS-0003",
      identifier: "ENS-0003",
    });
    teachersApiMock.list
      .mockResolvedValueOnce([
        {
          id: "CD-2026-0001-ENS-0001",
          teacherCode: "CD-2026-0001-ENS-0001",
          publicId: "CD-2026-0001-ENS-0001",
          identifier: "ENS-0001",
          firstName: "Aïssatou",
          lastName: "Ndiaye",
          name: "Aïssatou Ndiaye",
          phone: "+243",
          email: "",
          speciality: "",
          mainSubject: "",
          schoolCode: "CD-2026-0001",
          status: "Actif",
          gender: "",
          birthDate: "",
          entryDate: "",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "CD-2026-0001-ENS-0001",
          teacherCode: "CD-2026-0001-ENS-0001",
          publicId: "CD-2026-0001-ENS-0001",
          identifier: "ENS-0001",
          firstName: "Aïssatou",
          lastName: "Ndiaye",
          name: "Aïssatou Ndiaye",
          phone: "+243",
          email: "",
          speciality: "",
          mainSubject: "",
          schoolCode: "CD-2026-0001",
          status: "Actif",
          gender: "",
          birthDate: "",
          entryDate: "",
        },
        {
          id: "CD-2026-0001-ENS-0003",
          teacherCode: "CD-2026-0001-ENS-0003",
          publicId: "CD-2026-0001-ENS-0003",
          identifier: "ENS-0003",
          firstName: "Fatou",
          lastName: "Sow",
          name: "Fatou Sow",
          phone: "+243 811",
          email: "",
          speciality: "",
          mainSubject: "",
          schoolCode: "CD-2026-0001",
          status: "Actif",
          gender: "",
          birthDate: "",
          entryDate: "",
        },
      ]);

    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getByRole("button", { name: "Ajouter un enseignant" }));
    await user.type(screen.getByLabelText(/Prénom/i), "Fatou");
    await user.type(screen.getByLabelText(/^Nom/i), "Sow");
    await user.type(screen.getByLabelText(/Date de naissance/i), "1990-05-01");
    await user.type(screen.getByLabelText(/Téléphone/i), "+243 811");
    await user.type(screen.getByLabelText(/Mot de passe temporaire/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /Créer l'enseignant/i }));

    await waitFor(() => {
      expect(teachersApiMock.create).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: "Fatou",
          lastName: "Sow",
          birthDate: "1990-05-01",
          phone: "+243 811",
          temporaryPassword: "TempPass1",
        }),
      );
    });
    expect(await screen.findByText("Sow")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      "Enseignant créé avec son compte de connexion.",
      "success",
    );
  });

  it("affiche les erreurs 409 dans le formulaire", async () => {
    const user = userEvent.setup();
    teachersApiMock.create.mockRejectedValue(
      new ApiError("Identité enseignant ambiguë", 409),
    );
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getByRole("button", { name: "Ajouter un enseignant" }));
    await user.type(screen.getByLabelText(/Prénom/i), "Aïssatou");
    await user.type(screen.getByLabelText(/^Nom/i), "Ndiaye");
    await user.type(screen.getByLabelText(/Date de naissance/i), "1985-01-01");
    await user.type(screen.getByLabelText(/Email/i), "a@example.com");
    await user.type(screen.getByLabelText(/Mot de passe temporaire/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /Créer l'enseignant/i }));

    expect(await screen.findByText("Identité enseignant ambiguë")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("Identité enseignant ambiguë", "error");
  });

  it("filtre la liste côté client", async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText("Ndiaye");
    const search = screen.getByRole("searchbox", { name: /Rechercher dans enseignants/i });
    await user.type(search, "Ndiaye");
    expect(screen.getByText("Ndiaye")).toBeInTheDocument();
    expect(screen.queryByText("Ba")).not.toBeInTheDocument();
  });

  it("affiche EmptyState lorsque la liste est vide", async () => {
    teachersApiMock.list.mockResolvedValue([]);
    renderPage();
    const empty = await screen.findByRole("status");
    expect(empty).toHaveTextContent("Liste vide");
  });

  it("affiche ForbiddenState si accès refusé", () => {
    permissions.canRead = false;
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.queryByRole("heading", { name: "Enseignants" })).not.toBeInTheDocument();
  });

  it("n'expose pas Modifier / Supprimer / Affecter actifs", async () => {
    renderPage();
    await screen.findByText("Ndiaye");
    const list = screen.getByLabelText("Liste");
    expect(within(list).queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Affecter" })).not.toBeInTheDocument();
  });
});
