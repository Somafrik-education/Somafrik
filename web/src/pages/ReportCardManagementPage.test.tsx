import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ApiError } from "../api/client";
import type { ReportCardDraft, ReportCardPresentation } from "../lib/reportCardManagementApi";

const api = vi.hoisted(() => ({
  listClasses: vi.fn(),
  listActiveModels: vi.fn(),
  preview: vi.fn(),
  publish: vi.fn(),
  listPublications: vi.fn(),
  presentation: vi.fn(),
  pdf: vi.fn(),
}));
const listHistory = vi.hoisted(() => vi.fn());
const listModelRequests = vi.hoisted(() => vi.fn());
const session = vi.hoisted(() => ({
  current: { user: { role: "Admin School", permissions: ["Bulletins:READ", "Bulletins:UPDATE"] } } as {
    user: { role: string; permissions: string[] };
  },
}));

vi.mock("../lib/reportCardManagementApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reportCardManagementApi")>();
  return { ...actual, reportCardManagementApi: api, listBulletinModelRequests: listModelRequests };
});
vi.mock("../lib/reportCardHistoryApi", () => ({ reportCardHistoryApi: { listHistory: (...args: unknown[]) => listHistory(...args) } }));
vi.mock("../lib/academicYearsApi", () => ({
  academicYearsApi: {
    list: vi.fn(async () => [{ id: "year-1", schoolCode: "BI", name: "2026-2027", startDate: "", endDate: "", status: "open", isCurrent: true }]),
  },
}));
vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: session.current, permissionsReady: true, permissionsBootstrap: "ready", permissionsBootstrapError: null }),
}));

function view(code: string, name: string, official = false, overrides: Partial<ReportCardPresentation> = {}): ReportCardPresentation {
  return {
    official,
    report_card_id: null,
    version: null,
    verification_status: null,
    published_at: null,
    period_scope: "ANNUAL",
    style: "simple",
    school: { name: "Lycée La Colombière" },
    class_name: "6ème A",
    academic_year: "2026-2027",
    student: { code, name },
    periods: [
      { id: "T1", label: "Trimestre 1" },
      { id: "T2", label: "Trimestre 2" },
    ],
    components: [
      { id: "TJ", label: "TJ" },
      { id: "EX", label: "EX" },
    ],
    rows: [
      {
        subject_id: "GEOGRAPHIE",
        parent_id: null,
        kind: "simple",
        level: 0,
        label: "Géographie",
        periods: {
          T1: { status: "COMPLETE", points: 80, max: 100, percentage: 80, components: { TJ: { state: "NUMERIC", value: 24, max: 30 }, EX: { state: "NUMERIC", value: 56, max: 70 } } },
          T2: { status: "INCOMPLETE", points: 21, max: 100, percentage: 21, components: { TJ: { state: "NUMERIC", value: 21, max: 30 }, EX: { state: "MISSING", value: null, max: 70 } } },
        },
        annual: { status: "INCOMPLETE", points: 101, max: 200, percentage: 50.5 },
      },
    ],
    totals: {
      periods: { T1: { status: "COMPLETE", points: 80, max: 100, percentage: 80, rank: { value: 1, ranked: 2 } }, T2: { status: "INCOMPLETE", points: 21, max: 100, percentage: 21, rank: { value: null, reason: "INCOMPLETE" } } },
      annual: { status: "COMPLETE", points: 623, max: 770, percentage: 80.91, rank: { value: 1, ranked: 2 } },
    },
    status: "COMPLETE",
    cohort_size: 2,
    issues: [],
    decision: null,
    signatures: [],
    ...overrides,
  };
}

function draft(overrides: Partial<ReportCardDraft> = {}): ReportCardDraft {
  return {
    official: false,
    draft_sha256: "sha-draft-1",
    publishable: true,
    period_scope: "ANNUAL",
    class_id: "class-1",
    academic_year_id: "year-1",
    model_key: "colombiere",
    issues: [],
    students: [
      { report_card_id: "rc-1", student_id: "COL-001", status: "COMPLETE", issues: [], presentation: view("COL-001", "Ndayishimiye Ama") },
      { report_card_id: "rc-2", student_id: "COL-002", status: "COMPLETE", issues: [], presentation: view("COL-002", "Irakoze Bo", false, { totals: { periods: {}, annual: { status: "COMPLETE", points: 385, max: 770, percentage: 50, rank: { value: 2, ranked: 2 } } } }) },
    ],
    ...overrides,
  };
}

async function renderPage() {
  const { ReportCardManagementPage } = await import("./ReportCardManagementPage");
  render(
    <MemoryRouter>
      <ReportCardManagementPage />
    </MemoryRouter>,
  );
  await waitFor(() => expect(api.listClasses).toHaveBeenCalled());
}

async function selectClassAndPreview() {
  await waitFor(() => expect(screen.getByLabelText("Classe").querySelectorAll("option").length).toBeGreaterThan(1));
  await waitFor(() => expect(screen.getByLabelText("Modèle de bulletin")).toHaveValue("colombiere"));
  fireEvent.change(screen.getByLabelText("Classe"), { target: { value: "class-1" } });
  fireEvent.click(screen.getByTestId("rc-preview"));
  await screen.findByTestId("rc-students");
}

describe("BULLETIN-UI-01 — gestion des bulletins (Web)", () => {
  beforeEach(() => {
    Object.values(api).forEach((fn) => fn.mockReset());
    listHistory.mockReset();
    listModelRequests.mockReset();
    listModelRequests.mockResolvedValue([{ model_key: "colombiere", status: "ACTIVE", description: "La Colombière" }]);
    session.current = { user: { role: "Admin School", permissions: ["Bulletins:READ", "Bulletins:UPDATE"] } };
    api.listClasses.mockResolvedValue([
      { id: "class-1", name: "6ème A", academicYearId: "year-1" },
      { id: "class-other-year", name: "5ème B", academicYearId: "year-0" },
    ]);
    api.listActiveModels.mockResolvedValue([{ model_key: "colombiere", description: "La Colombière" }]);
    api.listPublications.mockResolvedValue([]);
    api.preview.mockResolvedValue(draft());
  });

  it("aucune action à l'ouverture : ni aperçu ni publication ; classes filtrées par année", async () => {
    await renderPage();
    expect(api.preview).not.toHaveBeenCalled();
    expect(api.publish).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByLabelText("Classe").querySelectorAll("option").length).toBe(2));
    expect(screen.getByLabelText("Classe")).not.toHaveTextContent("5ème B");
  });

  it("sélection année / classe / période → aperçu non officiel : élèves, matricules, statut, pourcentage, rang", async () => {
    await renderPage();
    await selectClassAndPreview();
    expect(api.preview).toHaveBeenCalledWith({ academicYearId: "year-1", classId: "class-1", modelKey: "colombiere", period: "ANNUAL" });
    const rows = screen.getAllByTestId("rc-student-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Ndayishimiye Ama");
    expect(rows[0]).toHaveTextContent("COL-001");
    expect(rows[0]).toHaveTextContent("Non publié");
    expect(rows[0]).toHaveTextContent("80.91 %");
    expect(rows[0]).toHaveTextContent("1 / 2");
    // Les périodes proviennent de l'aperçu (moteur), jamais d'une liste codée en dur.
    expect(screen.getByLabelText("Période")).toHaveTextContent("Trimestre 1");
    fireEvent.click(within(rows[0]).getByText("Prévisualiser"));
    expect(screen.getByTestId("report-card-draft-banner")).toHaveTextContent("BROUILLON");
    expect(screen.getByTestId("report-card-presentation")).toHaveAttribute("data-official", "false");
  });

  it("publication : confirmation explicite (classe, période, nombre) avant tout envoi, empreinte de l'aperçu", async () => {
    api.publish.mockResolvedValue({ ok: true, status: "PUBLISHED", draft_sha256: "sha-draft-1", publications: [{ report_card_id: "rc-1" }, { report_card_id: "rc-2" }] });
    await renderPage();
    await selectClassAndPreview();
    fireEvent.click(screen.getByTestId("rc-publish"));
    const dialog = screen.getByTestId("rc-confirm");
    expect(within(dialog).getByTestId("rc-confirm-class")).toHaveTextContent("6ème A");
    expect(within(dialog).getByTestId("rc-confirm-period")).toHaveTextContent("Bilan annuel");
    expect(within(dialog).getByTestId("rc-confirm-count")).toHaveTextContent("2");
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByText("Annuler"));
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("rc-publish"));
    fireEvent.click(screen.getByTestId("rc-confirm-publish"));
    await waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1));
    expect(api.publish).toHaveBeenCalledWith({ academicYearId: "year-1", classId: "class-1", modelKey: "colombiere", period: "ANNUAL" }, "sha-draft-1");
    expect(await screen.findByRole("status")).toHaveTextContent("Publication officielle effectuée (2 bulletin(s))");
  });

  it("BULLETIN-NOTES-02 : l'anomalie commune donne le titre de l'évaluation une seule fois", async () => {
    api.preview.mockResolvedValue(draft({
      publishable: false,
      issues: [{
        code: "EVALUATION_TYPE_UNMAPPED",
        severity: "blocking",
        evaluation_id: "oral-001",
        evaluation_title: "LES ADVERBES",
        evaluation_type: "orale",
        subject_id: "001",
        period_id: "T1",
      }],
      students: [
        { report_card_id: "rc-1", student_id: "COL-001", status: "INCOMPLETE", issues: [], presentation: view("COL-001", "Ndayishimiye Ama") },
        { report_card_id: "rc-2", student_id: "COL-002", status: "INCOMPLETE", issues: [], presentation: view("COL-002", "Irakoze Bo") },
      ],
    }));
    await renderPage();
    await selectClassAndPreview();
    const classIssues = screen.getByTestId("rc-class-issues");
    expect(classIssues).toHaveTextContent("LES ADVERBES");
    expect(classIssues).toHaveTextContent("orale");
    expect(classIssues).toHaveTextContent("001");
    expect(within(classIssues).getAllByRole("listitem")).toHaveLength(1);
    expect(screen.queryByText(/Anomalies \(1\)/)).not.toBeInTheDocument();
  });

  it("anomalies : brouillon incomplet non publiable ; refus serveur traduit sans fuite", async () => {
    api.preview.mockResolvedValue(
      draft({
        publishable: false,
        students: [
          {
            report_card_id: "rc-1",
            student_id: "COL-001",
            status: "INCOMPLETE",
            issues: [{ code: "MISSING_SCORE", reason: "NOT_ENTERED", subject_id: "GEOGRAPHIE", period_id: "T2", score_component_id: "EX" }],
            presentation: view("COL-001", "Ndayishimiye Ama"),
          },
        ],
      }),
    );
    await renderPage();
    await selectClassAndPreview();
    expect(screen.getByTestId("rc-not-publishable")).toBeInTheDocument();
    expect(screen.getByTestId("rc-publish")).toBeDisabled();
    fireEvent.click(screen.getByText("Anomalies (1)"));
    expect(screen.getByTestId("rc-anomalies")).toHaveTextContent("Note manquante (note non saisie) — GEOGRAPHIE · T2 · EX");
  });

  it("refus serveur à la publication (notes modifiées) : message métier, aucune donnée technique", async () => {
    api.publish.mockRejectedValue(new ApiError("internal stack at pg://secret", 409, "DRAFT_CHANGED"));
    await renderPage();
    await selectClassAndPreview();
    fireEvent.click(screen.getByTestId("rc-publish"));
    fireEvent.click(screen.getByTestId("rc-confirm-publish"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Les notes ont changé depuis l'aperçu");
    expect(alert).not.toHaveTextContent("pg://secret");
  });

  it("changer de période invalide l'aperçu : impossible de publier un brouillon périmé", async () => {
    await renderPage();
    await selectClassAndPreview();
    fireEvent.change(screen.getByLabelText("Période"), { target: { value: "T1" } });
    expect(screen.queryByTestId("rc-students")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rc-publish")).not.toBeInTheDocument();
  });

  it("enseignant sans droit de publication : ni aperçu ni bouton de publication", async () => {
    session.current = { user: { role: "Enseignant", permissions: ["Bulletins:READ", "Voir bulletins"] } };
    await renderPage();
    expect(screen.queryByTestId("rc-preview")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rc-publish")).not.toBeInTheDocument();
    expect(screen.getByTestId("rc-no-preview-right")).toBeInTheDocument();
  });

  it("aperçu refusé par le serveur (403) : droits insuffisants affichés", async () => {
    api.preview.mockRejectedValue(new ApiError("Forbidden", 403, "RBAC_DENIED"));
    await renderPage();
    await waitFor(() => expect(screen.getByLabelText("Classe").querySelectorAll("option").length).toBeGreaterThan(1));
    fireEvent.change(screen.getByLabelText("Classe"), { target: { value: "class-1" } });
    fireEvent.click(screen.getByTestId("rc-preview"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Droits insuffisants");
  });

  it("bulletin publié : consultation officielle (sans bandeau), PDF, impression, versions", async () => {
    api.listPublications.mockResolvedValue([{ report_card_id: "rc-1", published_snapshot_version: 2, verification_status: "ACTIVE" }]);
    api.presentation.mockResolvedValue({ presentation: [view("COL-001", "Ndayishimiye Ama", true)], verificationStatus: "ACTIVE" });
    api.pdf.mockResolvedValue(new Blob(["%PDF"], { type: "application/pdf" }));
    listHistory.mockResolvedValue({ ok: true, versions: [{ report_card_id: "rc-1", published_snapshot_version: 2, verification_status: "ACTIVE" }, { report_card_id: "rc-1", published_snapshot_version: 1, verification_status: "SUPERSEDED" }] });
    const createObjectURL = vi.fn(() => "blob:pdf");
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const open = vi.spyOn(window, "open").mockReturnValue({} as Window);
    await renderPage();
    await selectClassAndPreview();
    expect(screen.getAllByTestId("rc-student-status")[0]).toHaveTextContent("Publié (v2)");
    fireEvent.click(screen.getByText("Bulletin publié"));
    await waitFor(() => expect(api.presentation).toHaveBeenCalled());
    const card = await screen.findByTestId("rc-official");
    expect(api.presentation).toHaveBeenCalledWith("rc-1", 2);
    expect(within(card).getByTestId("report-card-presentation")).toHaveAttribute("data-official", "true");
    expect(within(card).queryByTestId("report-card-draft-banner")).not.toBeInTheDocument();
    expect(within(card).getByTestId("rc-history")).toHaveTextContent("v1 — Remplacé");
    fireEvent.click(within(card).getByTestId("rc-download-pdf"));
    await waitFor(() => expect(api.pdf).toHaveBeenCalledWith("rc-1", 2));
    fireEvent.click(within(card).getByTestId("rc-print-pdf"));
    await waitFor(() => expect(open).toHaveBeenCalledWith("blob:pdf", "_blank", "noopener"));
    open.mockRestore();
  });
  it("aucun modèle configuré : message explicite et accès au parcours de demande", async () => {
    listModelRequests.mockResolvedValue([]);
    await renderPage();
    expect(await screen.findByTestId("rc-model-empty")).toHaveTextContent("Aucun modèle de bulletin configuré");
    expect(screen.getByRole("link", { name: "Demander ou suivre un modèle de bulletin" })).toHaveAttribute("href", "/bulletins/modele");
    expect(screen.getByLabelText("Modèle de bulletin")).toHaveTextContent("Aucun modèle actif");
    expect(screen.getByTestId("rc-preview")).toBeDisabled();
  });

  it("modèle en attente : statut réellement renvoyé par l'API, sans activation implicite", async () => {
    listModelRequests.mockResolvedValue([{ model_key: "modele-A", description: "La Colombière", status: "READY_FOR_REVIEW" }]);
    await renderPage();
    expect(await screen.findByTestId("rc-model-pending")).toHaveTextContent("READY_FOR_REVIEW");
    expect(screen.getByTestId("rc-model-empty")).toHaveTextContent("Aucun modèle de bulletin actif");
    expect(screen.getByTestId("rc-preview")).toBeDisabled();
  });

  it("échec HTTP des modèles : message d'erreur, pas de faux état vide et reprise possible", async () => {
    listModelRequests.mockRejectedValueOnce(new ApiError("private stack", 503, "UPSTREAM_ERROR"));
    await renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Impossible de charger les modèles");
    expect(alert).not.toHaveTextContent("private stack");
    expect(screen.queryByTestId("rc-model-empty")).not.toBeInTheDocument();
    listModelRequests.mockResolvedValue([{ model_key: "colombiere", status: "ACTIVE", description: "La Colombière" }]);
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(screen.queryByTestId("rc-model-error")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByLabelText("Modèle de bulletin")).toHaveValue("colombiere"));
  });

});
