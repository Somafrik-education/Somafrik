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

vi.mock("../../lib/teacherAssignmentsApi", () => ({
  teacherAssignmentsApi: teacherAssignmentsApiMock,
}));

vi.mock("../../lib/classesApi", () => ({
  classesApi: classesApiMock,
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

describe("TeachersListPage (création compte + fiche)", () => {
  beforeEach(() => {
    permissions.canRead = true;
    permissions.canCreate = true;
    permissions.canUpdate = true;
    permissions.canDelete = true;
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

  it("affiche les erreurs 400 dans le formulaire", async () => {
    const user = userEvent.setup();
    teachersApiMock.create.mockRejectedValue(
      new ApiError("Au moins un moyen de contact est requis (phone ou email).", 400),
    );
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getByRole("button", { name: "Ajouter un enseignant" }));
    await user.type(screen.getByLabelText(/Prénom/i), "Invalide");
    await user.type(screen.getByLabelText(/^Nom/i), "Contact");
    await user.type(screen.getByLabelText(/Date de naissance/i), "1990-01-01");
    await user.type(screen.getByLabelText(/Mot de passe temporaire/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /Créer l'enseignant/i }));

    expect(
      await screen.findByText("Au moins un moyen de contact est requis (phone ou email)."),
    ).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith(
      "Au moins un moyen de contact est requis (phone ou email).",
      "error",
    );
  });

  it("affiche les erreurs 403 dans le formulaire", async () => {
    const user = userEvent.setup();
    teachersApiMock.create.mockRejectedValue(new ApiError("Permission insuffisante", 403));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getByRole("button", { name: "Ajouter un enseignant" }));
    await user.type(screen.getByLabelText(/Prénom/i), "Refuse");
    await user.type(screen.getByLabelText(/^Nom/i), "Authz");
    await user.type(screen.getByLabelText(/Date de naissance/i), "1990-01-01");
    await user.type(screen.getByLabelText(/Téléphone/i), "+243 1");
    await user.type(screen.getByLabelText(/Mot de passe temporaire/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /Créer l'enseignant/i }));

    expect(await screen.findByText("Permission insuffisante")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("Permission insuffisante", "error");
  });

  it("affiche les erreurs serveur 500 dans le formulaire", async () => {
    const user = userEvent.setup();
    teachersApiMock.create.mockRejectedValue(new ApiError("Erreur interne", 500));
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getByRole("button", { name: "Ajouter un enseignant" }));
    await user.type(screen.getByLabelText(/Prénom/i), "Serveur");
    await user.type(screen.getByLabelText(/^Nom/i), "Erreur");
    await user.type(screen.getByLabelText(/Date de naissance/i), "1990-01-01");
    await user.type(screen.getByLabelText(/Email/i), "s@example.com");
    await user.type(screen.getByLabelText(/Mot de passe temporaire/i), "TempPass1");
    await user.click(screen.getByRole("button", { name: /Créer l'enseignant/i }));

    expect(await screen.findByText("Erreur interne")).toBeInTheDocument();
    expect(showToast).toHaveBeenCalledWith("Erreur interne", "error");
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
    expect(within(list).getAllByRole("button", { name: "Affecter" }).length).toBeGreaterThan(0);
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

  it("affecte un enseignant via teacherAssignmentsApi puis recharge", async () => {
    const user = userEvent.setup();
    teacherAssignmentsApiMock.create.mockResolvedValue({ id: "asg-1" });
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter" })[0]);
    expect(await screen.findByLabelText(/Classe/i)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Classe/i), "CLS-6A");
    await user.selectOptions(screen.getByLabelText(/Matière/i), "SUB-MATH");
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
      new ApiError("Ce cours est déjà affecté à un enseignant pour cette classe.", 409),
    );
    renderPage();
    await screen.findByText("Ndiaye");
    await user.click(screen.getAllByRole("button", { name: "Affecter" })[0]);
    await user.selectOptions(await screen.findByLabelText(/Classe/i), "CLS-6A");
    await user.selectOptions(screen.getByLabelText(/Matière/i), "SUB-MATH");
    await user.click(screen.getByRole("button", { name: /Enregistrer l'affectation/i }));
    expect(
      await screen.findByText("Ce cours est déjà affecté à un enseignant pour cette classe."),
    ).toBeInTheDocument();
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
