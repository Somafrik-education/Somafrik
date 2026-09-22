import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { BackOfficeState, SessionUser, StudentFee, StudentUnpaidRow } from "../../types";
import { FinanceUnpaidPage } from "./FinanceUnpaidPage";
import { ApiError } from "../../api/client";
import { UNPAID_UNKNOWN_CURRENCY_LABEL } from "../../lib/unpaidModule";

const refresh = vi.hoisted(() => vi.fn(async () => undefined));
const listUnpaid = vi.hoisted(() => vi.fn());
const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_CODE = "CD-IN-26-001";

const authState = vi.hoisted(() => ({
  session: {
    user: {
      id: "user-1",
      role: "Comptable",
      schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schoolCode: "CD-IN-26-001",
      schoolPublicCode: "CD-IN-26-001",
      permissions: ["Impayés:READ", "Paiements:READ"],
    } as SessionUser,
    accessToken: "test-token",
  },
}));

const dataState = vi.hoisted(() => ({ current: null as unknown as BackOfficeState }));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: authState.session,
    permissionsReady: true,
    permissionsBootstrap: "ready",
    permissionsBootstrapError: null,
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: SCHOOL_CODE, scopedUser: authState.session.user }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({ state: dataState.current, refresh, update: vi.fn() }),
}));

vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    createPayment: vi.fn(),
    listPaymentStudentOptions: vi.fn().mockResolvedValue([]),
    getFinanceCatalog: vi.fn().mockResolvedValue({ currency: "CDF", paymentMethods: [] }),
    listStudentFees: vi.fn(),
    listUnpaid,
    createReminder: vi.fn(),
  },
}));

function unpaidRow(overrides: Partial<StudentUnpaidRow> & Pick<StudentUnpaidRow, "studentId" | "studentName">): StudentUnpaidRow {
  return {
    className: "6ème A",
    schoolCode: SCHOOL_CODE,
    periodLabel: "T1",
    amountExpected: 100_000,
    amountPaid: 40_000,
    amountDue: 60_000,
    currency: "CDF",
    daysLate: 12,
    severity: "Retard moyen",
    status: "En retard",
    feeIds: [`fee-${overrides.studentId}`],
    reminderCount: 0,
    ...overrides,
  };
}

function feeFor(row: StudentUnpaidRow): StudentFee {
  return {
    id: row.feeIds[0],
    studentId: row.studentId,
    studentName: row.studentName,
    schoolId: SCHOOL_ID,
    schoolCode: row.schoolCode,
    className: row.className,
    schoolFeeItemId: `item-${row.studentId}`,
    feeGridId: "grid-1",
    feeType: "Scolarité",
    label: "Scolarité T1",
    currency: row.currency,
    academicYear: "2025-2026",
    initialAmount: row.amountExpected,
    discount: 0,
    exemption: 0,
    amountDue: row.amountExpected,
    amountPaid: row.amountPaid,
    balance: row.amountDue,
    status: "En retard",
    dueDate: "2020-01-15",
    periodLabel: row.periodLabel,
  };
}

function emptyState(): BackOfficeState {
  return {
    schools: [{ id: SCHOOL_ID, code: SCHOOL_CODE, name: "Lycée Test", currency: "CDF" }],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [],
    teachers: [],
    classes: [],
    courses: [],
    assignments: [],
    payments: [],
    presences: [],
    notes: [],
    exams: [],
    bulletins: [],
    documents: [],
    announcements: [],
    messages: [],
    paymentStatuses: [],
    studentFees: [],
    paymentReminders: [],
    rolePermissions: {},
    academicConfigs: {},
  } as unknown as BackOfficeState;
}

function renderPage() {
  return render(
    <MemoryRouter>
      <FinanceUnpaidPage />
    </MemoryRouter>,
  );
}

describe("Impayés Web — smoke P1 devise / Oscar / 403", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dataState.current = emptyState();
  });

  it("affiche CDF, USD et la créance sans devise, sans total unique", async () => {
    const rows = [
      unpaidRow({ studentId: "cdf", studentName: "Ada CDF", amountDue: 120_000, currency: "CDF" }),
      unpaidRow({ studentId: "usd", studentName: "Ada USD", amountDue: 50, currency: "USD", className: "6ème B" }),
      unpaidRow({ studentId: "unk", studentName: "Ada Inconnue", amountDue: 50, currency: "", className: "6ème C" }),
    ];
    listUnpaid.mockResolvedValue({ rows, fees: rows.map(feeFor) });
    renderPage();
    expect((await screen.findAllByText("Ada CDF")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Total restant CDF/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Total restant USD/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`Total restant ${UNPAID_UNKNOWN_CURRENCY_LABEL}`)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/50 · Devise non renseignée/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/120[\s\u202f\u00a0]?100/)).not.toBeInTheDocument();
  });

  it("Oscar : Montant attendu et Montant alloué aux impayés ouverts", async () => {
    const row = unpaidRow({ studentId: "oscar", studentName: "Oscar Test" });
    listUnpaid.mockResolvedValue({ rows: [row], fees: [feeFor(row)] });
    renderPage();
    const detail = await screen.findAllByRole("button", { name: "Détail" });
    await userEvent.click(detail[0]);
    expect(await screen.findByText("Montant attendu")).toBeInTheDocument();
    expect(screen.getByText("Montant alloué aux impayés ouverts")).toBeInTheDocument();
    expect(screen.queryByText(/déjà payé/i)).not.toBeInTheDocument();
  });

  it("403 n'est pas présenté comme une liste vide", async () => {
    listUnpaid.mockRejectedValue(new ApiError("Accès refusé", 403));
    renderPage();
    expect(await screen.findByText("Accès refusé")).toBeInTheDocument();
    expect(screen.getByText(/Impayés:READ/)).toBeInTheDocument();
    expect(screen.queryByText("Aucun reste à payer")).not.toBeInTheDocument();
  });

  it("401 n'est pas présenté comme une liste vide", async () => {
    listUnpaid.mockRejectedValue(new ApiError("Non authentifié", 401));
    renderPage();
    expect(await screen.findByText("Impossible de charger les impayés")).toBeInTheDocument();
    expect(screen.getByText(/Session expirée/)).toBeInTheDocument();
    expect(screen.queryByText("Aucun reste à payer")).not.toBeInTheDocument();
  });
});
