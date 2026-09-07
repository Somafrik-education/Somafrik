import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackOfficeState, SessionUser, StudentFee } from "../../types";
import { FinanceUnpaidPage } from "./FinanceUnpaidPage";
import {
  BLOCKING_OBLIGATION_MISMATCH_MESSAGE,
  CLASS_NAME,
  OBLIGATION_INSC_ID,
  OBLIGATION_SCO_ID,
  OPEN_BALANCE_CDF,
  OTHER_STUDENT_CODE,
  OTHER_STUDENT_UUID,
  SCHOOL_CODE,
  SCHOOL_ID,
  STUDENT_CODE,
  STUDENT_FIRST_NAME,
  STUDENT_LAST_NAME,
  STUDENT_NAME,
  STUDENT_UUID,
  FOREIGN_TENANT_CODE,
  FOREIGN_TENANT_UUID,
  paymentStudentOptionRow,
  postgresObligationRow,
} from "../../lib/financeStudentIdentity.fixtures";

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
const createPayment = vi.hoisted(() => vi.fn());
const listPaymentStudentOptions = vi.hoisted(() => vi.fn());
const getFinanceCatalog = vi.hoisted(() => vi.fn());
const listStudentFees = vi.hoisted(() => vi.fn());

const authState = vi.hoisted(() => ({
  session: {
    user: {
      id: "user-1",
      role: "Comptable",
      schoolId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      schoolCode: "CD-IN-26-001",
      schoolPublicCode: "CD-IN-26-001",
      permissions: ["Impayés:READ", "Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE"],
    } as SessionUser,
    accessToken: "test-token",
  },
}));

const dataState = vi.hoisted(() => ({
  current: null as unknown as BackOfficeState,
}));

vi.mock("../../context/AuthContext", () => ({
  useAuth: () => ({
    session: authState.session,
    permissionsReady: true,
    permissionsBootstrap: "ready",
    permissionsBootstrapError: null,
  }),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: SCHOOL_CODE,
    scopedUser: authState.session.user,
  }),
}));

vi.mock("../../context/DataContext", () => ({
  useData: () => ({
    state: dataState.current,
    refresh,
    update: vi.fn(),
  }),
}));

vi.mock("../../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: vi.fn() }),
}));

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    createPayment,
    listPaymentStudentOptions,
    getFinanceCatalog,
    listStudentFees,
    createReminder: vi.fn(),
  },
}));

function overlayFee(overrides: Partial<StudentFee> & Pick<StudentFee, "id" | "studentId" | "label">): StudentFee {
  return {
    studentName: STUDENT_NAME,
    schoolId: SCHOOL_ID,
    schoolCode: SCHOOL_CODE,
    className: CLASS_NAME,
    schoolFeeItemId: `item-${overrides.id}`,
    feeGridId: "grid-1",
    feeType: "Scolarité",
    currency: "CDF",
    academicYear: "2025-2026",
    initialAmount: OPEN_BALANCE_CDF,
    discount: 0,
    exemption: 0,
    amountDue: OPEN_BALANCE_CDF,
    amountPaid: 0,
    balance: OPEN_BALANCE_CDF,
    status: "En retard",
    dueDate: "2020-01-15",
    periodLabel: "T1",
    ...overrides,
  };
}

function emptyState(fees: StudentFee[]): BackOfficeState {
  return {
    schools: [{ id: SCHOOL_ID, code: SCHOOL_CODE, name: "Lycée Test", currency: "CDF" }],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [
      {
        id: STUDENT_CODE,
        publicId: STUDENT_CODE,
        name: STUDENT_NAME,
        firstName: STUDENT_FIRST_NAME,
        lastName: STUDENT_LAST_NAME,
        matricule: STUDENT_CODE,
        schoolId: SCHOOL_ID,
        schoolCode: SCHOOL_CODE,
        className: CLASS_NAME,
      },
      {
        id: OTHER_STUDENT_CODE,
        publicId: OTHER_STUDENT_CODE,
        name: "Binta Traoré",
        firstName: "Binta",
        lastName: "Traoré",
        matricule: OTHER_STUDENT_CODE,
        schoolId: SCHOOL_ID,
        schoolCode: SCHOOL_CODE,
        className: CLASS_NAME,
      },
    ] as never,
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
    studentFees: fees,
    paymentReminders: [],
    rolePermissions: {},
    academicConfigs: {},
  };
}

function catalogOk() {
  getFinanceCatalog.mockResolvedValue({
    currency: "CDF",
    paymentMethods: [{ label: "Espèces", active: true }],
  });
}

function studentOptionsPostgresContract() {
  listPaymentStudentOptions.mockResolvedValue([
    paymentStudentOptionRow(),
    paymentStudentOptionRow({
      studentId: OTHER_STUDENT_UUID,
      firstName: "Binta",
      lastName: "Traoré",
      studentCode: OTHER_STUDENT_CODE,
    }),
  ]);
}

async function openPaymentFromUnpaidRow() {
  const user = userEvent.setup();
  const buttons = screen.getAllByTestId(`unpaid-register-payment-${STUDENT_CODE}`);
  await user.click(buttons[0]);
  await screen.findByTestId("quick-payment-modal");
  return user;
}

describe("IMP-FAST — enregistrement rapide Impayés (contrat UUID ↔ code public)", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    refresh.mockResolvedValue(undefined);
    createPayment.mockReset();
    listPaymentStudentOptions.mockReset();
    getFinanceCatalog.mockReset();
    listStudentFees.mockReset();
    catalogOk();
    studentOptionsPostgresContract();
    listStudentFees.mockResolvedValue([postgresObligationRow()]);
    createPayment.mockResolvedValue({ id: "pay-1", amount: 40_000, allocatedAmount: 40_000 });
    dataState.current = emptyState([
      overlayFee({
        id: OBLIGATION_SCO_ID,
        studentId: STUDENT_CODE,
        label: "Scolarité T1",
      }),
    ]);
  });

  it("IMP-FAST-RED-01 — clic Impayés sélectionne l'élève demandé sans saisie ni recherche", async () => {
    render(<FinanceUnpaidPage />);
    expect(screen.getAllByText(STUDENT_NAME).length).toBeGreaterThan(0);
    await openPaymentFromUnpaidRow();

    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(selected).toHaveTextContent(STUDENT_CODE);
    expect(selected).toHaveTextContent(CLASS_NAME);
    expect(screen.queryByTestId("payment-student-search")).not.toBeInTheDocument();
    expect(screen.queryByText(/Saisissez au moins 2 caractères/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/Nom, matricule ou code élève/i)).not.toBeInTheDocument();
  });

  it("IMP-FAST-RED-03 — obligation unique 140000 CDF auto-sélectionnée, Non imputé n'est pas le défaut", async () => {
    render(<FinanceUnpaidPage />);
    await openPaymentFromUnpaidRow();

    const modal = await screen.findByTestId("quick-payment-modal");
    expect(within(modal).queryByText(/Aucune obligation ouverte/i)).not.toBeInTheDocument();
    expect(within(modal).getByText("Scolarité T1")).toBeInTheDocument();
    expect(within(modal).getAllByText(/140[\s\u202f\u00a0]?000 CDF/).length).toBeGreaterThan(0);

    const feeSelect = within(modal).getByLabelText(/Frais concerné/i) as HTMLSelectElement;
    expect(feeSelect.value).toBe(OBLIGATION_SCO_ID);
    expect(feeSelect.value).not.toBe("__unallocated__");
    expect(within(feeSelect).getByRole("option", { name: /Scolarité T1/i })).toBeInTheDocument();
  });

  it("IMP-FAST-RED-04 — initialStudentId = code public alors que payment-student-options.studentId = UUID → élève préselectionné", async () => {
    render(<FinanceUnpaidPage />);
    const unpaidButton = screen.getAllByTestId(`unpaid-register-payment-${STUDENT_CODE}`)[0];
    expect(unpaidButton).toBeInTheDocument();
    await openPaymentFromUnpaidRow();

    expect(listPaymentStudentOptions).toHaveBeenCalled();
    const option = listPaymentStudentOptions.mock.results[0]?.value;
    await waitFor(() => expect(option).toBeTruthy());
    const resolved = await option;
    expect(resolved[0].studentId).toBe(STUDENT_UUID);
    expect(resolved[0].studentCode).toBe(STUDENT_CODE);

    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(selected).toHaveTextContent(STUDENT_CODE);
  });

  it("IMP-FAST-RED-05 — plusieurs obligations ouvertes du même élève, aucune d'un autre élève ou tenant", async () => {
    dataState.current = emptyState([
      overlayFee({
        id: OBLIGATION_INSC_ID,
        studentId: STUDENT_CODE,
        label: "Inscription",
        feeType: "Inscription",
        amountDue: 50_000,
        balance: 50_000,
        initialAmount: 50_000,
      }),
      overlayFee({
        id: OBLIGATION_SCO_ID,
        studentId: STUDENT_CODE,
        label: "Scolarité T1",
      }),
      overlayFee({
        id: "obl-other",
        studentId: OTHER_STUDENT_CODE,
        studentName: "Binta Traoré",
        label: "Uniforme autre élève",
        feeType: "Uniforme",
        amountDue: 20_000,
        balance: 20_000,
        initialAmount: 20_000,
      }),
    ]);
    listStudentFees.mockResolvedValue([
      postgresObligationRow({
        id: OBLIGATION_INSC_ID,
        obligationId: OBLIGATION_INSC_ID,
        label: "Inscription",
        feeType: "Inscription",
        balance: 50_000,
        amountDue: 50_000,
      }),
      postgresObligationRow(),
      postgresObligationRow({
        id: "obl-other",
        obligationId: "obl-other",
        studentId: OTHER_STUDENT_CODE,
        studentDbId: OTHER_STUDENT_UUID,
        label: "Uniforme autre élève",
        feeType: "Uniforme",
        balance: 20_000,
        amountDue: 20_000,
      }),
      postgresObligationRow({
        id: "obl-foreign",
        obligationId: "obl-foreign",
        studentId: FOREIGN_TENANT_CODE,
        studentDbId: FOREIGN_TENANT_UUID,
        label: "Scolarité tenant B",
        feeType: "Scolarité",
        balance: 99_000,
        amountDue: 99_000,
      }),
    ]);

    render(<FinanceUnpaidPage />);
    await openPaymentFromUnpaidRow();
    const modal = screen.getByTestId("quick-payment-modal");
    expect(within(modal).getByText("Inscription")).toBeInTheDocument();
    expect(within(modal).getByText("Scolarité T1")).toBeInTheDocument();
    expect(within(modal).queryByText("Uniforme autre élève")).not.toBeInTheDocument();
    expect(within(modal).queryByText("Scolarité tenant B")).not.toBeInTheDocument();
    expect(within(modal).queryByText("Binta Traoré")).not.toBeInTheDocument();
  });

  it("IMP-FAST-RED-06 — solde Impayés > 0 sans obligation résoluble → erreur bloquante, pas de Non imputé silencieux", async () => {
    listStudentFees.mockResolvedValue([]);
    render(<FinanceUnpaidPage />);
    const user = await openPaymentFromUnpaidRow();
    const modal = screen.getByTestId("quick-payment-modal");

    await waitFor(() => {
      expect(within(modal).getByText(/Impossible de retrouver les frais ouverts de cet élève/i)).toBeInTheDocument();
    });
    expect(within(modal).getByText(/Actualisez les données ou contactez l'administrateur/i)).toBeInTheDocument();
    expect(within(modal).queryByText(/sera enregistré en non imputé/i)).not.toBeInTheDocument();

    const feeSelect = within(modal).queryByLabelText(/Frais concerné/i) as HTMLSelectElement | null;
    if (feeSelect) {
      expect(feeSelect.value).not.toBe("__unallocated__");
    }

    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    expect(createPayment).not.toHaveBeenCalled();
    expect(JSON.stringify(createPayment.mock.calls)).not.toMatch(/Non imputé/);
    expect(BLOCKING_OBLIGATION_MISMATCH_MESSAGE.length).toBeGreaterThan(20);
  });
});
