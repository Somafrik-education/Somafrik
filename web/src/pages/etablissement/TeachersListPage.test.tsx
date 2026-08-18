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

const assignmentPermissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: false,
}));

const teachersApiMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  get: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const teacherAssignmentsApiMock = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));

const classesApiMock = vi.hoisted(() => ({
  list: vi.fn(),
}));

const showToast = vi.hoisted(() => vi.fn());

const permissionContext = vi.hoisted(() => ({
  user: { role: "Admin School", schoolCode: "CD-2026-0001" },
  permissionsReady: true as boolean,
  permissionsBootstrap: "ready" as "idle" | "loading" | "ready" | "error",
  permissionsBootstrapError: null as string | null,
}));

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
  usePermissionContext: () => permissionContext,
}));

vi.mock("../../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/permissions")>();
  return {
    ...actual,
    getEntityFeaturePermissions: (
      _ctx: unknown,
      moduleKey: string,
      feature: string,
    ) => {
      if (moduleKey === "assignments" || feature === "Affectations") {
        return { ...assignmentPermissions };
      }
      return { ...permissions };
    },
  };
});

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../lib/teachersApi", () => ({
  teachersApi: teachersApiMock,
}));

vi.mock("../../lib/teacherAssignmentsApi", () => ({
  teacherAssignmentsApi: teacherAssignmentsApiMock,
}));

vi.mock("../../lib/classesApi", () => ({
  classesApi: classesApiMock,
}));

vi.mock("../../api/client", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    constructor(message: string, status: number, code?: string) {
      super(message);
      this.status = status;
      this.code = code;
    }
  },
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}));

import { TeachersListPage } from "./TeachersListPage";
import { ApiError, api } from "../../api/client";

function renderPage() {
  return render(
    <MemoryRouter>
      <TeachersListPage />
    </MemoryRouter>,
  );
}

describe("TeachersListPage (fiche métier, sans création d'identité)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
    assignmentPermissions.canRead = true;
    assignmentPermissions.canCreate = true;
    assignmentPermissions.canUpdate = true;
    assignmentPermissions.canDelete = false;
    permissionContext.permissionsReady = true;
    permissionContext.permissionsBootstrap = "ready";
    permissionContext.permissionsBootstrapError = null;
    teachersApiMock.list.mockReset();
    teachersApiMock.create.mockReset();
    teachersApiMock.update.mockReset();
    teachersApiMock.remove.mockReset();
    teacherAssignmentsApiMock.create.mockReset();
    classesApiMock.list.mockReset();
    classesApiMock.list.mockResolvedValue([
      { classCode: "CLS-6A", name: "6ème A", status: "active" },
    ]);
    vi.mocked(api.get).mockResolvedValue([{ code: "SUB-MATH", name: "Mathématiques", status: "active" }]);
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
        gender: "Féminin",
        birthDate: "1985-01-01",
        entryDate: "2010-09-01",
        assignedClasses: [],
        courses: [],
        assignments: [],
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
        gender: "Masculin",
        birthDate: "1982-03-12",
        entryDate: "2011-09-01",
        assignedClasses: ["6ème A"],
        courses: ["Mathématiques"],
        assignments: [{ className: "6ème A", course: "Mathématiques" }],
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

  it("n'affiche plus le bouton de création d'enseignant", async () => {
    renderPage();
    expect(await screen.findByText("Ndiaye")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Ajouter un enseignant" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Créer l'enseignant/i })).not.toBeInTheDocument();
    expect(teachersApiMock.create).not.toHaveBeenCalled();
  });

  it("affiche une erreur de chargement liste (serveur)", async () => {
    teachersApiMock.list.mockRejectedValue(new ApiError("Service indisponible", 503));
    renderPage();
    expect(await screen.findByText("Service indisponible")).toBeInTheDocument();
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

  it("affiche Modifier / Affecter / Supprimer selon les permissions", async () => {
    renderPage();
    await screen.findByText("Ndiaye");
    const list = screen.getByLabelText("Liste");
    expect(within(list).getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0);
    expect(within(list).getAllByRole("button", { name: "Affecter un cours" }).length).toBeGreaterThan(0);
    expect(within(list).getAllByRole("button", { name: "Supprimer" }).length).toBeGreaterThan(0);
  });

  it("masque les boutons d'écriture sans permission", async () => {
    permissions.canUpdate = false;
    permissions.canDelete = false;
    renderPage();
    await screen.findByText("Ndiaye");
    const list = screen.getByLabelText("Liste");
    expect(within(list).queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(within(list).queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
    expect(within(list).getAllByRole("button", { name: "Affecter un cours" }).length).toBeGreaterThan(0);
  });

  it("masque Affecter sans Affectations:CREATE même si Enseignants:UPDATE", async () => {
    assignmentPermissions.canCreate = false;
    renderPage();
    await screen.findByText("Ndiaye");
    const list = screen.getByLabelText("Liste");
    expect(within(list).getAllByRole("button", { name: "Modifier" }).length).toBeGreaterThan(0);
    expect(within(list).queryByRole("button", { name: "Affecter un cours" })).not.toBeInTheDocument();
  });

  it("modifie un enseignant via PATCH puis recharge", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockResolvedValue({ teacherCode: "CD-2026-0001-ENS-0001" });
    teachersApiMock.list.mockResolvedValueOnce([
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
        gender: "Féminin",
        birthDate: "1985-01-01",
        entryDate: "2010-09-01",
      },
    ]).mockResolvedValueOnce([
      {
        id: "CD-2026-0001-ENS-0001",
        teacherCode: "CD-2026-0001-ENS-0001",
        publicId: "CD-2026-0001-ENS-0001",
        identifier: "ENS-0001",
        firstName: "Aïssatou",
        lastName: "Ndiaye",
        name: "Aïssatou Ndiaye",
        phone: "+243 800",
        email: "aissatou@example.com",
        speciality: "Physique",
        mainSubject: "Physique",
        schoolCode: "CD-2026-0001",
        status: "Actif",
        gender: "Féminin",
        birthDate: "1985-01-01",
        entryDate: "2010-09-01",
      },
    ]);
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    expect(screen.queryByLabelText(/Mot de passe temporaire/i)).not.toBeInTheDocument();
    const speciality = screen.getByLabelText(/Spécialité/i);
    await user.clear(speciality);
    await user.type(speciality, "Physique");
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    await waitFor(() => {
      expect(teachersApiMock.update).toHaveBeenCalledWith(
        "CD-2026-0001-ENS-0001",
        expect.objectContaining({ speciality: "Physique" }),
      );
    });
    expect(showToast).toHaveBeenCalledWith("Enseignant modifié.", "success");
    expect(teachersApiMock.list.mock.calls.length).toBeGreaterThan(1);
  });

  it("masque l'écran métier tant que les permissions live ne sont pas prêtes", () => {
    permissionContext.permissionsReady = false;
    permissionContext.permissionsBootstrap = "loading";
    renderPage();
    expect(screen.getByText(/Chargement des droits/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Affecter un cours" })).not.toBeInTheDocument();
  });

  it("affiche une erreur explicite si le bootstrap permissions échoue", () => {
    permissionContext.permissionsReady = false;
    permissionContext.permissionsBootstrap = "error";
    permissionContext.permissionsBootstrapError = "Impossible de charger les permissions effectives.";
    renderPage();
    expect(screen.getByText(/Permissions indisponibles/i)).toBeInTheDocument();
    expect(screen.getByText(/Impossible de charger les permissions effectives/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Affecter un cours" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Accès non autorisé/i)).not.toBeInTheDocument();
  });

  it("affecte un enseignant via teacherAssignmentsApi puis recharge", async () => {
    const user = userEvent.setup();
    teacherAssignmentsApiMock.create.mockResolvedValue({ id: "asg-1" });
    renderPage();
    await screen.findByText("Ndiaye");
    expect(screen.getAllByRole("button", { name: "Affecter un cours" }).length).toBeGreaterThan(0);
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    expect(await screen.findByLabelText(/Classe/i)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Mathématiques" })).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Classe/i), "CLS-6A");
    await user.selectOptions(screen.getByLabelText(/^Cours/), "SUB-MATH");
    await user.click(screen.getByRole("button", { name: /Enregistrer l'affectation/i }));
    await waitFor(() => {
      expect(teacherAssignmentsApiMock.create).toHaveBeenCalledWith({
        teacherCode: "CD-2026-0001-ENS-0001",
        classCode: "CLS-6A",
        subjectCode: "SUB-MATH",
      });
    });
    expect(teacherAssignmentsApiMock.create.mock.calls[0][0].schoolCode).toBeUndefined();
    expect(showToast).toHaveBeenCalledWith("Affectation enregistrée.", "success");
  });

  it("archive un enseignant après confirmation et le retire de la liste", async () => {
    const user = userEvent.setup();
    teachersApiMock.remove.mockResolvedValue({ teacherCode: "CD-2026-0001-ENS-0001", archived: true });
    teachersApiMock.list.mockReset();
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
      ])
      .mockResolvedValueOnce([]);
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    expect(await screen.findByText(/désactive son compte de connexion/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Confirmer la suppression/i }));
    await waitFor(() => {
      expect(teachersApiMock.remove).toHaveBeenCalledWith("CD-2026-0001-ENS-0001");
    });
    await waitFor(() => {
      expect(screen.queryByText("Ndiaye")).not.toBeInTheDocument();
    });
  });

  it("affiche les erreurs 404/409 de modification", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockRejectedValue(new ApiError("Enseignant introuvable.", 404));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(await screen.findByText("Enseignant introuvable.")).toBeInTheDocument();
  });

  it("affiche les erreurs 400 de modification", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockRejectedValueOnce(new ApiError("Au moins un moyen de contact est requis (phone ou email).", 400));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(await screen.findByText(/moyen de contact/i)).toBeInTheDocument();
  });

  it("affiche les erreurs 403 de modification", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockRejectedValue(new ApiError("Permission insuffisante", 403));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(await screen.findByText("Permission insuffisante")).toBeInTheDocument();
  });

  it("affiche les erreurs 409 de modification", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockRejectedValue(new ApiError("Un compte avec cet email ou ce téléphone existe déjà.", 409));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(await screen.findByText(/email ou ce téléphone/i)).toBeInTheDocument();
  });

  it("affiche les erreurs 500 de modification", async () => {
    const user = userEvent.setup();
    teachersApiMock.update.mockRejectedValue(new ApiError("Erreur interne", 500));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Modifier" })[0]);
    await user.click(screen.getByRole("button", { name: /Enregistrer/i }));
    expect(await screen.findByText("Erreur interne")).toBeInTheDocument();
  });

  it("affiche les erreurs 409 d'affectation", async () => {
    const user = userEvent.setup();
    teacherAssignmentsApiMock.create.mockRejectedValue(
      new ApiError(
        "Cette affectation existe déjà pour cet enseignant.",
        409,
        "TEACHER_ASSIGNMENT_ALREADY_EXISTS",
      ),
    );
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    await user.selectOptions(await screen.findByLabelText(/Classe/i), "CLS-6A");
    await user.selectOptions(screen.getByLabelText(/^Cours/), "SUB-MATH");
    await user.click(screen.getByRole("button", { name: /Enregistrer l'affectation/i }));
    expect(
      await screen.findByText("TEACHER_ASSIGNMENT_ALREADY_EXISTS · Cette affectation existe déjà pour cet enseignant."),
    ).toBeInTheDocument();
  });

  it("affiche une erreur catalogue si GET /v2/subjects = 500, pas « Aucun cours »", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockRejectedValue(new ApiError("Erreur interne catalogue", 500));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    expect(await screen.findByText(/Catalogue de cours indisponible/i)).toBeInTheDocument();
    expect(screen.getByText(/Erreur interne catalogue/i)).toBeInTheDocument();
    expect(screen.queryByText(/Aucun cours canonique/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer l'affectation/i })).toBeDisabled();
  });

  it("affiche « Aucun cours » si GET /v2/subjects = 200 [] sans fallback locale", async () => {
    const user = userEvent.setup();
    vi.mocked(api.get).mockResolvedValue([]);
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    expect(await screen.findByText(/Aucun cours canonique/i)).toBeInTheDocument();
    expect(screen.queryByText(/Catalogue de cours indisponible/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Mathématiques" })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Français" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer l'affectation/i })).toBeDisabled();
  });

  it("affiche un état vide si aucune classe n'est disponible", async () => {
    const user = userEvent.setup();
    classesApiMock.list.mockResolvedValue([]);
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    expect(await screen.findByText(/Aucune classe active/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enregistrer l'affectation/i })).toBeDisabled();
  });

  it("affiche la colonne Affectations depuis PostgreSQL", async () => {
    renderPage();
    await screen.findByText("Ba");
    expect(screen.getByText("6ème A · Mathématiques")).toBeInTheDocument();
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThan(0);
  });

  it("rafraîchit la colonne Affectations après un POST réussi", async () => {
    const user = userEvent.setup();
    teacherAssignmentsApiMock.create.mockResolvedValue({ id: "asg-1" });
    teachersApiMock.list.mockResolvedValueOnce([
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
        gender: "Féminin",
        birthDate: "1985-01-01",
        entryDate: "2010-09-01",
        assignments: [],
        assignedClasses: [],
        courses: [],
      },
    ]).mockResolvedValueOnce([
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
        gender: "Féminin",
        birthDate: "1985-01-01",
        entryDate: "2010-09-01",
        assignments: [{ className: "6ème A", course: "Mathématiques" }],
        assignedClasses: ["6ème A"],
        courses: ["Mathématiques"],
      },
    ]);
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter un cours" })[0]);
    await user.selectOptions(await screen.findByLabelText(/Classe/i), "CLS-6A");
    await user.selectOptions(screen.getByLabelText(/^Cours/), "SUB-MATH");
    await user.click(screen.getByRole("button", { name: /Enregistrer l'affectation/i }));
    expect(await screen.findByText("6ème A · Mathématiques")).toBeInTheDocument();
  });

  it("affiche les erreurs 409 de suppression", async () => {
    const user = userEvent.setup();
    teachersApiMock.remove.mockRejectedValue(
      new ApiError("Cet enseignant possède encore des cours ou créneaux actifs. Retirez-les avant suppression.", 409),
    );
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    await user.click(screen.getByRole("button", { name: /Confirmer la suppression/i }));
    expect(await screen.findByText(/cours ou créneaux actifs/i)).toBeInTheDocument();
  });

  it("affiche les erreurs 403/404/500 de suppression", async () => {
    const user = userEvent.setup();
    teachersApiMock.remove.mockRejectedValueOnce(new ApiError("Permission insuffisante", 403));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    await user.click(screen.getByRole("button", { name: /Confirmer la suppression/i }));
    expect(await screen.findByText("Permission insuffisante")).toBeInTheDocument();
  });

  it("affiche les erreurs 404 de suppression", async () => {
    const user = userEvent.setup();
    teachersApiMock.remove.mockRejectedValue(new ApiError("Enseignant introuvable.", 404));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    await user.click(screen.getByRole("button", { name: /Confirmer la suppression/i }));
    expect(await screen.findByText("Enseignant introuvable.")).toBeInTheDocument();
  });

  it("affiche les erreurs 500 de suppression", async () => {
    const user = userEvent.setup();
    teachersApiMock.remove.mockRejectedValue(new ApiError("Erreur interne", 500));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Supprimer" })[0]);
    await user.click(screen.getByRole("button", { name: /Confirmer la suppression/i }));
    expect(await screen.findByText("Erreur interne")).toBeInTheDocument();
  });
});
