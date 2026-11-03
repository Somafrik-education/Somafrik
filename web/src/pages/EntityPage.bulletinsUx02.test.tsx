/**
 * BULLETIN-UX-02 — module Bulletins (Pédagogie → Bulletins) :
 * « Configurer un bulletin » remplace « Demander un modèle de bulletin »,
 * plus de bouton générique « Ajouter » (Bulletins seulement), statuts en
 * français sans confondre Généré et Publié, exports inchangés.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { EntityPage } from "./EntityPage";
import { reportCardStatusLabel } from "../lib/reportCardStatus";

const scopedRows = vi.hoisted(() => vi.fn());
const downloadCsv = vi.hoisted(() => vi.fn());
const rowsToCsv = vi.hoisted(() => vi.fn(() => "csv"));
const perms = vi.hoisted(() => ({ current: { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canSuspend: false } }));

const BULLETINS = [
  { id: "bul-1", studentName: "Élève Un", className: "6e A", period: "Trimestre 1", average: 12, status: "generated" },
  { id: "bul-2", studentName: "Élève Deux", className: "6e A", period: "Trimestre 1", average: 15, status: "published" },
  { id: "bul-3", studentName: "Élève Trois", className: "6e A", period: "Trimestre 1", average: 9, status: "archived" },
  { id: "bul-4", studentName: "Élève Quatre", className: "6e A", period: "Trimestre 1", average: 11, status: "draft" },
];
const CLASSES = [{ id: "cls-1", name: "6e A", level: "6e", schoolCode: "SCH-001", status: "active" }];
const DOCUMENTS = [{ id: "doc-1", studentName: "Élève Un", documentType: "Attestation", title: "Attestation de scolarité", status: "Disponible" }];

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } }, permissionsReady: true }),
}));
vi.mock("../context/DataContext", () => ({
  useData: () => ({
    state: { schools: [{ id: "school-1", code: "SCH-001", name: "École test" }], students: [], classes: CLASSES, teachers: [], users: [], assignments: [], relations: [], payments: [], bulletins: BULLETINS, auditLogs: [], academicConfigs: [] },
    update: vi.fn(),
    refresh: vi.fn(),
  }),
}));
vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "SCH-001", requiresSelection: false, scopedUser: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } }),
}));
vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({}),
  useFeaturePermissions: () => perms.current,
}));
vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock("../components/ui/PromptDialog", () => ({ usePrompt: () => ({ prompt: vi.fn() }) }));
vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getEntityFeaturePermissions: () => perms.current };
});
vi.mock("../lib/entityModules", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getScopedEntityRows: scopedRows };
});
vi.mock("../lib/csv", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, downloadCsv, rowsToCsv };
});

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderEntity(entity: "bulletins" | "documents", path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={<EntityPage entity={entity} />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  perms.current = { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canSuspend: false };
  scopedRows.mockImplementation((key: string) => (key === "bulletins" ? BULLETINS : key === "documents" ? DOCUMENTS : []));
});

describe("BULLETIN-UX-02 — boutons du module Bulletins", () => {
  it("pas de bouton « Ajouter » ; « Configurer un bulletin » et « Gérer les bulletins » présents (droit CREATE)", async () => {
    renderEntity("bulletins", "/bulletins");
    await screen.findAllByText("Élève Un");
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.getByTestId("report-card-request-model-cta")).toHaveTextContent("Configurer un bulletin");
    expect(screen.queryByText("Demander un modèle de bulletin")).toBeNull();
    expect(screen.getByTestId("report-card-management-cta")).toHaveTextContent("Gérer les bulletins");
    // Impression et exports conservés.
    expect(screen.getByRole("button", { name: "Exporter CSV" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Exporter Excel" })).toBeEnabled();
  });

  it("« Configurer un bulletin » ouvre /bulletins/modele ; « Gérer les bulletins » ouvre /bulletins/gestion", async () => {
    renderEntity("bulletins", "/bulletins");
    fireEvent.click(await screen.findByTestId("report-card-request-model-cta"));
    expect(screen.getByTestId("where")).toHaveTextContent("/bulletins/modele");
  });

  it("« Gérer les bulletins » ouvre /bulletins/gestion", async () => {
    renderEntity("bulletins", "/bulletins");
    fireEvent.click(await screen.findByTestId("report-card-management-cta"));
    expect(screen.getByTestId("where")).toHaveTextContent("/bulletins/gestion");
  });

  it("le bouton « Ajouter » des autres modules est conservé", async () => {
    renderEntity("documents", "/administration/documents");
    expect(await screen.findByRole("button", { name: "Ajouter" })).toBeInTheDocument();
  });

  it("lecture seule (ex. enseignant) : ni configuration, ni ajout ; consultation conservée", async () => {
    perms.current = { canRead: true, canCreate: false, canUpdate: false, canDelete: false, canSuspend: false };
    renderEntity("bulletins", "/bulletins");
    await screen.findAllByText("Élève Un");
    expect(screen.queryByTestId("report-card-request-model-cta")).toBeNull();
    expect(screen.queryByRole("button", { name: "Ajouter" })).toBeNull();
    expect(screen.getByTestId("report-card-management-cta")).toBeInTheDocument();
  });
});

describe("BULLETIN-UX-02 — statuts", () => {
  it("statuts historiques affichés en français ; Généré n'est jamais Publié", async () => {
    renderEntity("bulletins", "/bulletins");
    await screen.findAllByText("Élève Un");
    const table = screen.getAllByRole("table")[0];
    const rowOf = (name: string) => within(table).getAllByText(name)[0].closest("tr") as HTMLElement;
    expect(rowOf("Élève Un")).toHaveTextContent("Généré");
    expect(rowOf("Élève Un")).not.toHaveTextContent("Publié");
    expect(rowOf("Élève Deux")).toHaveTextContent("Publié");
    expect(rowOf("Élève Trois")).toHaveTextContent("Archivé");
    expect(rowOf("Élève Quatre")).toHaveTextContent("Brouillon");
    expect(within(table).queryByText("generated")).toBeNull();
    expect(within(table).queryByText("archived")).toBeNull();
  });

  it("export CSV : statut Backend d'origine transmis sans traduction silencieuse", async () => {
    renderEntity("bulletins", "/bulletins");
    fireEvent.click(await screen.findByRole("button", { name: "Exporter CSV" }));
    expect(rowsToCsv).toHaveBeenCalledTimes(1);
    const [rows] = rowsToCsv.mock.calls[0] as unknown as [Record<string, unknown>[]];
    expect(rows.map((row) => row.status)).toEqual(["generated", "published", "archived", "draft"]);
    expect(downloadCsv).toHaveBeenCalledTimes(1);
  });

  it("mapping explicite par source (historique, snapshots canoniques, brouillon)", () => {
    expect(reportCardStatusLabel("legacy", "generated")).toBe("Généré");
    expect(reportCardStatusLabel("legacy", "GENERATED")).toBe("Généré");
    expect(reportCardStatusLabel("legacy", "published")).toBe("Publié");
    expect(reportCardStatusLabel("legacy", "archived")).toBe("Archivé");
    expect(reportCardStatusLabel("legacy", "draft")).toBe("Brouillon");
    expect(reportCardStatusLabel("canonical", "ACTIVE")).toBe("Publié");
    expect(reportCardStatusLabel("canonical", "SUPERSEDED")).toBe("Remplacé");
    expect(reportCardStatusLabel("canonical", "REVOKED")).toBe("Révoqué");
    expect(reportCardStatusLabel("draft", "INCOMPLETE")).toBe("Incomplet");
    // « generated » n'appartient pas au contrat canonique : jamais traduit en « Publié ».
    expect(reportCardStatusLabel("canonical", "generated")).toBe("generated");
    expect(reportCardStatusLabel("legacy", "ACTIVE")).toBe("ACTIVE");
    expect(reportCardStatusLabel("legacy", "")).toBe("—");
  });
});
