/**
 * DEEPLINK-ENTITY — `/finances/paiements?paymentId=…` et `/bulletins?reportCardId=…`
 * doivent ouvrir la fiche exacte, pas seulement la liste.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { EntityPage } from "./EntityPage";

const showToast = vi.hoisted(() => vi.fn());
const scopedRows = vi.hoisted(() => vi.fn());

const PAYMENTS = [
  {
    id: "pay-1",
    reference: "PAY-0001",
    studentName: "Autre élève",
    amount: 1000,
    method: "Espèces",
    date: "2026-09-01",
    status: "Payé",
    schoolCode: "SCH-001",
  },
  {
    id: "pay-2",
    reference: "PAY-0002",
    studentName: "Élève visé",
    amount: 2500,
    method: "Mobile money",
    date: "2026-09-08",
    status: "Payé",
    schoolCode: "SCH-001",
  },
];

const BULLETINS = [
  { id: "bul-1", studentName: "Autre élève", className: "6e A", period: "Trimestre 1", average: 12, status: "Publié" },
  { id: "bul-2", studentName: "Élève visé", className: "6e A", period: "Trimestre 2", average: 15, status: "Brouillon" },
];

const dataState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } },
    permissionsReady: true,
  }),
}));

vi.mock("../context/DataContext", () => ({
  useData: () => ({ state: dataState.current, update: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    requiresSelection: false,
    scopedUser: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  usePermissionContext: () => ({}),
  useFeaturePermissions: () => ({ canRead: true, canCreate: true, canUpdate: true, canDelete: true }),
}));

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));
vi.mock("../components/ui/PromptDialog", () => ({ usePrompt: () => ({ prompt: vi.fn() }) }));

vi.mock("../lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getEntityFeaturePermissions: () => ({
      canRead: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    }),
  };
});

vi.mock("../lib/entityModules", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getScopedEntityRows: scopedRows };
});

beforeEach(() => {
  vi.clearAllMocks();
  dataState.current = {
    schools: [{ id: "school-1", code: "SCH-001", name: "École test" }],
    students: [],
    classes: [],
    teachers: [],
    users: [],
    assignments: [],
    relations: [],
    payments: PAYMENTS,
    bulletins: BULLETINS,
    auditLogs: [],
    academicConfigs: [],
  };
});

function renderEntity(entity: "payments" | "bulletins", path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <EntityPage entity={entity} />
    </MemoryRouter>,
  );
}

describe("DEEPLINK-ENTITY — paiement et bulletin ouverts par identifiant", () => {
  it("DEEPLINK-ENTITY-01 — paymentId ouvre le reçu du paiement visé", async () => {
    scopedRows.mockReturnValue(PAYMENTS);
    renderEntity("payments", "/finances/paiements?paymentId=pay-2");

    const receipt = await screen.findByTestId("payment-receipt");
    expect(receipt).toHaveAttribute("data-payment-id", "pay-2");
    expect(receipt).toHaveTextContent("PAY-0002");
    expect(receipt).not.toHaveTextContent("PAY-0001");
  });

  it("DEEPLINK-ENTITY-02 — sans paymentId, aucun reçu n'est ouvert d'office", async () => {
    scopedRows.mockReturnValue(PAYMENTS);
    renderEntity("payments", "/finances/paiements");

    expect((await screen.findAllByText("PAY-0002")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("payment-receipt")).toBeNull();
  });

  it("DEEPLINK-ENTITY-03 — un paymentId hors périmètre autorisé n'ouvre rien", async () => {
    scopedRows.mockReturnValue(PAYMENTS);
    renderEntity("payments", "/finances/paiements?paymentId=pay-autre-ecole");

    expect((await screen.findAllByText("PAY-0002")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("payment-receipt")).toBeNull();
  });

  it("DEEPLINK-ENTITY-04 — reportCardId ouvre le bulletin visé", async () => {
    scopedRows.mockReturnValue(BULLETINS);
    renderEntity("bulletins", "/bulletins?reportCardId=bul-2");

    const form = await screen.findByTestId("entity-edit-form");
    expect(form).toHaveAttribute("data-record-id", "bul-2");
  });

  it("DEEPLINK-ENTITY-05 — sans reportCardId, aucun bulletin n'est ouvert d'office", async () => {
    scopedRows.mockReturnValue(BULLETINS);
    renderEntity("bulletins", "/bulletins");

    expect((await screen.findAllByText("Trimestre 2")).length).toBeGreaterThan(0);
    expect(screen.queryByTestId("entity-edit-form")).toBeNull();
  });
});
