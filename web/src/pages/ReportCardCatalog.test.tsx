import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReportCardPresentation } from "../lib/reportCardManagementApi";

const api = vi.hoisted(() => ({
  adminOverview: vi.fn(),
  setAvailability: vi.fn(),
  adminAudit: vi.fn(),
  schoolCatalog: vi.fn(),
  configurationContext: vi.fn(),
  preview: vi.fn(),
  save: vi.fn(),
  activate: vi.fn(),
}));

vi.mock("../lib/reportCardCatalogApi", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/reportCardCatalogApi")>();
  return { ...actual, reportCardCatalogApi: api };
});

import { ReportCardCatalogAdminPage } from "./ReportCardCatalogAdminPage";
import { ReportCardCatalogSchoolPage } from "./ReportCardCatalogSchoolPage";

class ApiErr extends Error {
  constructor(public status: number, public code?: string, public details?: unknown) {
    super(code ?? "err");
  }
}

const preview: ReportCardPresentation = {
  official: false,
  report_card_id: null,
  version: null,
  verification_status: null,
  published_at: null,
  period_scope: "ANNUAL",
  style: "simple",
  school: { name: "Établissement d'exemple" },
  class_name: "Classe d'exemple",
  academic_year: "Année d'exemple",
  student: { code: "EXEMPLE", name: "Élève d'exemple" },
  periods: [{ id: "T1", label: "Trimestre 1" }],
  components: [{ id: "TJ", label: "TJ" }, { id: "EX", label: "EX" }],
  rows: [
    {
      subject_id: "MATH", parent_id: null, kind: "simple", level: 0, label: "Mathématiques",
      periods: { T1: { status: "COMPLETE", points: 17, max: 40, percentage: 42.5, failing: true, components: { TJ: { state: "NUMERIC", value: 8, max: 20, failing: true }, EX: { state: "NUMERIC", value: 9, max: 20, failing: true } } } },
      annual: null,
    },
  ],
  totals: { periods: { T1: { status: "COMPLETE", points: 17, max: 40, percentage: 42.5, rank: null } }, annual: null },
  status: "COMPLETE",
  cohort_size: 1,
  issues: [],
  decision: null,
  signatures: [],
};

const CD = { id: "c1", name: "République démocratique du Congo", iso_code: "CD" };
const BI = { id: "c2", name: "Burundi", iso_code: "BI" };
const colombiere = { model_id: "colombiere", version: 1, name: "Modèle Colombière", description: "Matières simples, TJ et EX.", presentation_style: "simple" as const, status: "active" as const, preview };
const berceau = { model_id: "berceau", version: 1, name: "Modèle Berceau", description: "Matières et sous-matières.", presentation_style: "hierarchical" as const, status: "active" as const, preview: { ...preview, style: "hierarchical" as const } };

function renderPage(node: JSX.Element) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockReset();
});

describe("Superadmin — Catalogue des bulletins", () => {
  it("galerie : aperçu réel, type, version, statut, pays autorisés ; aucun éditeur", async () => {
    api.adminOverview.mockResolvedValue({
      countries: [CD, BI],
      models: [
        { ...colombiere, availability: [{ country_id: "c1", available: true, updated_at: null, updated_by: null }] },
        { ...berceau, availability: [] },
      ],
    });
    renderPage(<ReportCardCatalogAdminPage />);
    const card = await screen.findByTestId("catalog-admin-model-colombiere");
    expect(within(card).getByText("Modèle Colombière")).toBeInTheDocument();
    expect(within(card).getByText("Matières simples")).toBeInTheDocument();
    expect(within(card).getByText("Version 1")).toBeInTheDocument();
    expect(within(card).getByText("Actif")).toBeInTheDocument();
    expect(within(card).getByTestId("catalog-model-thumbnail")).toBeInTheDocument();
    expect(within(card).getByTestId("catalog-admin-allowed")).toHaveTextContent("République démocratique du Congo");
    expect(within(screen.getByTestId("catalog-admin-model-berceau")).getByTestId("catalog-admin-allowed-none")).toBeInTheDocument();
    expect(screen.queryByText(/JSON|gabarit|éditeur/i)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bc1\b|colombiere@/);
  });

  it("filtres : pays, recherche, disponibilité ; aucun résultat explicite", async () => {
    api.adminOverview.mockResolvedValue({
      countries: [CD, BI],
      models: [
        { ...colombiere, availability: [{ country_id: "c1", available: true, updated_at: null, updated_by: null }] },
        { ...berceau, availability: [] },
      ],
    });
    renderPage(<ReportCardCatalogAdminPage />);
    await screen.findByTestId("catalog-admin-model-colombiere");
    fireEvent.change(screen.getByLabelText("Pays"), { target: { value: "c2" } });
    fireEvent.change(screen.getByLabelText("Disponibilité"), { target: { value: "AVAILABLE" } });
    expect(screen.getByTestId("catalog-admin-no-match")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Pays"), { target: { value: "c1" } });
    expect(screen.getByTestId("catalog-admin-model-colombiere")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-admin-model-berceau")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Disponibilité"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Rechercher un modèle"), { target: { value: "berceau" } });
    expect(screen.getByTestId("catalog-admin-model-berceau")).toBeInTheDocument();
    expect(screen.queryByTestId("catalog-admin-model-colombiere")).not.toBeInTheDocument();
  });

  it("disponibilité : confirmation explicite (modèle, pays, avant → après), puis historique", async () => {
    api.adminOverview.mockResolvedValueOnce({ countries: [CD, BI], models: [{ ...colombiere, availability: [] }] });
    api.adminAudit.mockResolvedValueOnce({ audit: [] });
    renderPage(<ReportCardCatalogAdminPage />);
    fireEvent.click(await screen.findByTestId("catalog-admin-manage-colombiere"));
    fireEvent.click(await screen.findByTestId("catalog-admin-toggle-BI"));
    const summary = screen.getByTestId("catalog-admin-confirm-summary");
    expect(summary).toHaveTextContent("Modèle Colombière");
    expect(summary).toHaveTextContent("Burundi");
    expect(summary).toHaveTextContent("Non disponible → Disponible");
    expect(api.setAvailability).not.toHaveBeenCalled();
    api.setAvailability.mockResolvedValue({ changed: true, previous: null, available: true });
    api.adminOverview.mockResolvedValueOnce({ countries: [CD, BI], models: [{ ...colombiere, availability: [{ country_id: "c2", available: true, updated_at: null, updated_by: null }] }] });
    api.adminAudit.mockResolvedValueOnce({
      audit: [{ id: 1, model_id: "colombiere", country_id: "c2", country_name: "Burundi", old_available: null, new_available: true, actor_id: "u", actor_label: "Awa Diallo", created_at: "2026-11-03T10:00:00Z" }],
    });
    fireEvent.click(screen.getByTestId("catalog-admin-confirm"));
    await waitFor(() => expect(api.setAvailability).toHaveBeenCalledWith("colombiere", "c2", true));
    expect(await screen.findByText(/est maintenant disponible pour Burundi/)).toBeInTheDocument();
    const audit = await screen.findByTestId("catalog-admin-audit");
    expect(audit).toHaveTextContent("Jamais configuré");
    expect(audit).toHaveTextContent("Awa Diallo");
    expect(screen.getByTestId("catalog-admin-toggle-BI")).toHaveTextContent("Retirer de ce pays");
  });

  it("retrait : rappelle que les configurations actives et bulletins publiés restent valides", async () => {
    api.adminOverview.mockResolvedValue({ countries: [CD], models: [{ ...colombiere, availability: [{ country_id: "c1", available: true, updated_at: null, updated_by: null }] }] });
    api.adminAudit.mockResolvedValue({ audit: [] });
    renderPage(<ReportCardCatalogAdminPage />);
    fireEvent.click(await screen.findByTestId("catalog-admin-manage-colombiere"));
    fireEvent.click(await screen.findByTestId("catalog-admin-toggle-CD"));
    expect(screen.getByTestId("catalog-admin-confirm-summary")).toHaveTextContent("restent valides");
  });

  it("états : chargement, erreur + Réessayer, accès refusé, catalogue vide", async () => {
    api.adminOverview.mockRejectedValueOnce(new ApiErr(500));
    renderPage(<ReportCardCatalogAdminPage />);
    expect(screen.getByTestId("catalog-admin-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("catalog-admin-error")).toBeInTheDocument();
    api.adminOverview.mockResolvedValueOnce({ countries: [], models: [] });
    fireEvent.click(screen.getByText("Réessayer"));
    expect(await screen.findByTestId("catalog-admin-empty")).toBeInTheDocument();
  });

  it("accès refusé et catalogue non installé (503)", async () => {
    api.adminOverview.mockRejectedValueOnce(new ApiErr(403, "PLATFORM_CONTEXT_REQUIRED"));
    const { unmount } = renderPage(<ReportCardCatalogAdminPage />);
    expect(await screen.findByTestId("catalog-admin-denied")).toBeInTheDocument();
    expect(screen.queryByText("Réessayer")).not.toBeInTheDocument();
    unmount();
    api.adminOverview.mockRejectedValueOnce(new ApiErr(503, "CATALOG_UNAVAILABLE"));
    renderPage(<ReportCardCatalogAdminPage />);
    expect(await screen.findByTestId("catalog-admin-not-installed")).toHaveTextContent(/pas encore installé/);
  });
});

describe("BULLETIN-PREPROD-01 — catalogue indisponible côté serveur", () => {
  it("Superadmin, tables absentes (503) : état explicite « non installé », référence support, pas d'alerte rouge", async () => {
    api.adminOverview.mockRejectedValueOnce(new ApiErr(503, "CATALOG_UNAVAILABLE"));
    renderPage(<ReportCardCatalogAdminPage />);
    const state = await screen.findByTestId("catalog-admin-not-installed");
    expect(state).toHaveTextContent("pas encore installé");
    expect(state).toHaveTextContent("CATALOG_UNAVAILABLE (HTTP 503)");
    expect(screen.queryByTestId("catalog-admin-error")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    api.adminOverview.mockResolvedValueOnce({ countries: [CD], models: [{ ...colombiere, availability: [] }] });
    fireEvent.click(screen.getByText("Vérifier à nouveau"));
    expect(await screen.findByTestId("catalog-admin-model-colombiere")).toBeInTheDocument();
  });

  it("Superadmin, API antérieure au catalogue (404 sans code) : « serveur pas à jour »", async () => {
    api.adminOverview.mockRejectedValueOnce(new ApiErr(404));
    renderPage(<ReportCardCatalogAdminPage />);
    expect(await screen.findByTestId("catalog-admin-outdated")).toHaveTextContent("ne propose pas encore le catalogue");
  });

  it("Établissement, 503 ou 404 : message non technique, bulletins publiés rassurés, retour possible", async () => {
    for (const err of [new ApiErr(503, "CATALOG_UNAVAILABLE"), new ApiErr(404)]) {
      api.schoolCatalog.mockRejectedValueOnce(err);
      const view = renderPage(<ReportCardCatalogSchoolPage />);
      const state = await screen.findByTestId("catalog-school-unavailable");
      expect(state).toHaveTextContent("pas encore disponible");
      expect(state).toHaveTextContent("bulletins déjà publiés restent consultables");
      expect(state.textContent).not.toMatch(/CATALOG_UNAVAILABLE|migration|HTTP/);
      expect(within(state).getByText("Retour aux bulletins")).toBeInTheDocument();
      view.unmount();
    }
  });

  it("modèle inconnu (404 CATALOG_MODEL_UNKNOWN) reste une erreur ordinaire, pas « serveur pas à jour »", async () => {
    api.schoolCatalog.mockRejectedValueOnce(new ApiErr(404, "CATALOG_MODEL_UNKNOWN"));
    renderPage(<ReportCardCatalogSchoolPage />);
    expect(await screen.findByTestId("catalog-school-error")).toBeInTheDocument();
  });
});

const CONTEXT = {
  model: colombiere,
  style: "simple",
  allowSubSubjects: false,
  suggestedStructure: "TJ_EX",
  structures: [
    { id: "TJ_EX", label: "Travail journalier (TJ) et examen (EX)", components: [{ id: "TJ", label: "TJ" }, { id: "EX", label: "EX" }] },
    { id: "SINGLE", label: "Note unique par période", components: [{ id: "NP", label: "Note" }] },
  ],
  periods: [{ id: "T1", label: "Trimestre 1" }, { id: "T2", label: "Trimestre 2" }, { id: "T3", label: "Trimestre 3" }],
  subjects: [
    { code: "MATH", name: "Mathématiques", parent_code: null },
    { code: "FR", name: "Français", parent_code: null },
    { code: "LANGUES", name: "Langues", parent_code: null },
    { code: "ANGLAIS", name: "Anglais", parent_code: "LANGUES" },
  ],
  evaluationTypes: [{ code: "interrogation", name: "Interrogation" }, { code: "examen", name: "Examen" }],
  terms: ["Trimestre 1", "Trimestre 2", "Trimestre 3"],
  configuration: "NONE",
  current: null,
};

function schoolCatalog(models: unknown[], extra: Record<string, unknown> = {}) {
  return { country: { id: "c1", name: "République démocratique du Congo" }, reason: null, canConfigure: true, models, ...extra };
}

describe("Établissement — Configurer un bulletin", () => {
  it("galerie : modèles autorisés, état, « Choisir ce modèle »", async () => {
    api.schoolCatalog.mockResolvedValue(
      schoolCatalog([
        { ...colombiere, available: true, configuration: "NONE", activated_at: null, saved_at: null },
        { ...berceau, available: false, configuration: "ACTIVE", activated_at: "2026-10-01", saved_at: null },
      ]),
    );
    renderPage(<ReportCardCatalogSchoolPage />);
    const card = await screen.findByTestId("catalog-school-model-colombiere");
    expect(within(card).getByText("Disponible")).toBeInTheDocument();
    expect(within(card).getByText("Choisir ce modèle")).toBeInTheDocument();
    const retired = screen.getByTestId("catalog-school-model-berceau");
    expect(within(retired).getByText("Actif dans l'établissement")).toBeInTheDocument();
    expect(within(retired).getByText(/restent valides/)).toBeInTheDocument();
    expect(within(retired).queryByRole("button")).not.toBeInTheDocument();
  });

  it("états : pays non reconnu, aucun modèle, erreur + Réessayer, accès refusé, lecture seule", async () => {
    api.schoolCatalog.mockResolvedValueOnce({ country: null, reason: "COUNTRY_UNKNOWN", canConfigure: true, models: [] });
    const first = renderPage(<ReportCardCatalogSchoolPage />);
    expect(await screen.findByTestId("catalog-school-no-country")).toBeInTheDocument();
    first.unmount();
    api.schoolCatalog.mockResolvedValueOnce(schoolCatalog([]));
    const second = renderPage(<ReportCardCatalogSchoolPage />);
    expect(await screen.findByTestId("catalog-school-empty")).toHaveTextContent("République démocratique du Congo");
    second.unmount();
    api.schoolCatalog.mockRejectedValueOnce(new ApiErr(500));
    const third = renderPage(<ReportCardCatalogSchoolPage />);
    expect(screen.getByTestId("catalog-school-loading")).toBeInTheDocument();
    expect(await screen.findByTestId("catalog-school-error")).toBeInTheDocument();
    api.schoolCatalog.mockResolvedValueOnce(schoolCatalog([{ ...colombiere, available: true, configuration: "NONE", activated_at: null, saved_at: null }], { canConfigure: false }));
    fireEvent.click(screen.getByText("Réessayer"));
    expect(await screen.findByTestId("catalog-school-readonly")).toBeInTheDocument();
    expect(screen.queryByText("Choisir ce modèle")).not.toBeInTheDocument();
    third.unmount();
    api.schoolCatalog.mockRejectedValueOnce(new ApiErr(403, "RBAC_DENIED"));
    renderPage(<ReportCardCatalogSchoolPage />);
    expect(await screen.findByTestId("catalog-school-denied")).toBeInTheDocument();
  });

  async function openWizard(context: unknown = CONTEXT) {
    api.schoolCatalog.mockResolvedValue(schoolCatalog([{ ...colombiere, available: true, configuration: "NONE", activated_at: null, saved_at: null }]));
    api.configurationContext.mockResolvedValue(context);
    renderPage(<ReportCardCatalogSchoolPage />);
    fireEvent.click(await screen.findByTestId("catalog-school-choose-colombiere"));
    await screen.findByTestId("catalog-step-structure");
  }

  it("assistant : structure suggérée, matières simples seulement, maxima, retour sans perte", async () => {
    await openWizard();
    expect(screen.getByLabelText(/Travail journalier/)).toBeChecked();
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByTestId("catalog-step-subjects")).toBeInTheDocument();
    expect(screen.queryByLabelText("Anglais")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Langues")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByText("Choisissez au moins une matière.")).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Mathématiques"));
    fireEvent.change(screen.getByLabelText("Maximum EX — Mathématiques"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Maximum TJ — Mathématiques"), { target: { value: "0" } });
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByText(/supérieur à 0/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Maximum TJ — Mathématiques"), { target: { value: "10" } });
    fireEvent.click(screen.getByText("Précédent"));
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByLabelText("Maximum TJ — Mathématiques")).toHaveValue("10");
    expect(screen.getByLabelText("Maximum EX — Mathématiques")).toHaveValue("");
  });

  it("note unique : aucune colonne TJ/EX imposée", async () => {
    await openWizard();
    fireEvent.click(screen.getByLabelText(/Note unique par période/));
    fireEvent.click(screen.getByTestId("catalog-next"));
    fireEvent.click(screen.getByLabelText("Français"));
    expect(screen.getByLabelText("Maximum Note — Français")).toHaveValue("20");
    expect(screen.queryByLabelText("Maximum TJ — Français")).not.toBeInTheDocument();
  });

  it("parcours complet : sources, aperçu réel, enregistrer (non activé), activer avec confirmation", async () => {
    await openWizard();
    fireEvent.click(screen.getByTestId("catalog-next"));
    fireEvent.click(screen.getByLabelText("Mathématiques"));
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByTestId("catalog-step-sources")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getAllByText("Choisissez au moins un type d'évaluation.")).toHaveLength(2);
    const [tjBox] = within(screen.getByText("Travail journalier (TJ)").closest("fieldset") as HTMLElement).getAllByLabelText("Interrogation");
    fireEvent.click(tjBox);
    fireEvent.click(within(screen.getByText("Examen (EX)").closest("fieldset") as HTMLElement).getByLabelText("Examen"));
    api.preview.mockResolvedValue(preview);
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(await screen.findByTestId("catalog-preview")).toBeInTheDocument();
    const sent = api.preview.mock.calls[0][1];
    expect(sent.subjects).toEqual([{ code: "MATH", components: { TJ: { max: 20 }, EX: { max: 20 } } }]);
    expect(sent.factSources).toEqual({ TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" }, EX: { evaluationTypes: ["examen"], aggregation: "sum" } });
    expect(sent.periods.T2).toEqual({ termNames: ["Trimestre 2"] });
    expect(screen.getByTestId("catalog-preview").querySelectorAll("[data-failing]").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(screen.getByTestId("catalog-activate")).toBeDisabled();
    api.save.mockResolvedValue({ status: "SAVED", preview });
    fireEvent.click(screen.getByTestId("catalog-save"));
    expect(await screen.findByTestId("catalog-saved")).toHaveTextContent("pas encore utilisée");
    expect(screen.getByTestId("catalog-summary-state")).toHaveTextContent("Enregistrée, non activée");
    fireEvent.click(screen.getByTestId("catalog-activate"));
    expect(screen.getByTestId("catalog-activate-summary")).toHaveTextContent("Modèle Colombière");
    expect(api.activate).not.toHaveBeenCalled();
    api.activate.mockResolvedValue({ status: "ACTIVE", model_key: "catalog-colombiere" });
    api.schoolCatalog.mockResolvedValue(schoolCatalog([{ ...colombiere, available: true, configuration: "ACTIVE", activated_at: "x", saved_at: null }]));
    fireEvent.click(screen.getByTestId("catalog-activate-confirm"));
    expect(await screen.findByTestId("catalog-school-notice")).toHaveTextContent("est activé");
    expect(api.activate.mock.calls[0][0]).toBe("colombiere");
  });

  it("erreurs serveur par champ : affichées à côté du champ, étape signalée ; activation refusée", async () => {
    await openWizard({
      ...CONTEXT,
      configuration: "SAVED",
      pendingSaved: true,
      current: {
        structure: "TJ_EX",
        subjects: [{ code: "MATH", components: { TJ: { max: 20 } } }],
        factSources: { TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" }, EX: { evaluationTypes: ["examen"], aggregation: "sum" } },
        periods: { T1: { termNames: ["Trimestre 1"] }, T2: { termNames: ["Trimestre 2"] }, T3: { termNames: ["Trimestre 3"] } },
        signatures: ["Le titulaire"],
      },
    } as unknown as typeof CONTEXT);
    fireEvent.click(screen.getByText("Récapitulatif"));
    expect(screen.getByTestId("catalog-summary-state")).toHaveTextContent("Enregistrée, non activée");
    api.activate.mockRejectedValueOnce(new ApiErr(409, "CATALOG_CONFIGURATION_REQUIRED"));
    fireEvent.click(screen.getByTestId("catalog-activate"));
    fireEvent.click(screen.getByTestId("catalog-activate-confirm"));
    expect(await screen.findByTestId("catalog-action-error")).toHaveTextContent("Activation refusée");
    api.save.mockRejectedValueOnce(new ApiErr(422, "CONFIGURATION_INVALID", [{ field: "subjects.0.TJ", code: "INVALID_MAX" }]));
    fireEvent.click(screen.getByTestId("catalog-save"));
    expect(await screen.findByTestId("catalog-step-subjects")).toBeInTheDocument();
    const row = screen.getByLabelText("Maximum TJ — Mathématiques").closest("td") as HTMLElement;
    expect(within(row).getByRole("alert")).toHaveTextContent(/supérieur à 0/);
    expect(screen.getByRole("button", { name: /Matières et maxima.*à corriger/ })).toBeInTheDocument();
  });

  it("référence de trimestre d'une autre année : aperçu bloqué, référence visible et retirable", async () => {
    await openWizard({
      ...CONTEXT,
      current: {
        structure: "TJ_EX",
        subjects: [{ code: "MATH", components: { TJ: { max: 20 }, EX: { max: 20 } } }],
        factSources: {
          TJ: { evaluationTypes: ["interrogation"], aggregation: "sum" },
          EX: { evaluationTypes: ["examen"], aggregation: "sum" },
        },
        periods: {
          T1: { termNames: ["Trimestre 1 - ancienne année"] },
          T2: { termNames: ["Trimestre 2"] },
          T3: { termNames: ["Trimestre 3"] },
        },
        signatures: [],
      },
    } as unknown as typeof CONTEXT);
    fireEvent.click(screen.getByText("Calcul des notes"));
    expect(screen.getByText(/Référence enregistrée indisponible : Trimestre 1 - ancienne année/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("catalog-next"));
    expect(api.preview).not.toHaveBeenCalled();
    expect(screen.getByText("Période scolaire inconnue pour l'année en cours.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retirer" }));
    expect(screen.queryByText(/Référence enregistrée indisponible/)).not.toBeInTheDocument();
    expect(api.save).not.toHaveBeenCalled();
  });

  it("quitter avec des modifications : confirmation, aucune perte silencieuse", async () => {
    await openWizard();
    fireEvent.click(screen.getByLabelText(/Note unique par période/));
    fireEvent.click(screen.getByText("← Retour aux modèles"));
    expect(screen.getByText("Quitter sans enregistrer ?")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Continuer la configuration"));
    expect(screen.getByLabelText(/Note unique par période/)).toBeChecked();
  });
});
