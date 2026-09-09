import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { BackOfficeState, SessionUser, StudentFee } from "../../types";
import { FinanceUnpaidPage } from "./FinanceUnpaidPage";

/** Les pages applicatives sont montées sous le Router : le deep-link lit l'URL. */
function RoutedFinanceUnpaidPage() {
  return (
    <MemoryRouter>
      <FinanceUnpaidPage />
    </MemoryRouter>
  );
}

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_CODE = "CD-IN-26-001";
const STUDENT_A = "stu-awa";
const STUDENT_B = "stu-binta";
const CLASS_ID = "class-6a";

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

function fee(overrides: Partial<StudentFee> & Pick<StudentFee, "id" | "studentId" | "label">): StudentFee {
  return {
    studentName: overrides.studentId === STUDENT_B ? "Binta Traoré" : "Awa Diop",
    schoolId: SCHOOL_ID,
    schoolCode: SCHOOL_CODE,
    className: "6ème A",
    schoolFeeItemId: `item-${overrides.id}`,
    feeGridId: "grid-1",
    feeType: "Scolarité",
    currency: "XOF",
    academicYear: "2025-2026",
    initialAmount: 100_000,
    discount: 0,
    exemption: 0,
    amountDue: 100_000,
    amountPaid: 0,
    balance: 100_000,
    status: "En retard",
    dueDate: "2020-01-15",
    periodLabel: "T1",
    ...overrides,
  };
}

function emptyState(fees: StudentFee[]): BackOfficeState {
  return {
    schools: [{ id: SCHOOL_ID, code: SCHOOL_CODE, name: "Lycée Test", currency: "XOF" }],
    users: [],
    countries: [],
    contacts: [],
    relations: [],
    subscriptions: [],
    notifications: [],
    students: [
      {
        id: STUDENT_A,
        name: "Awa Diop",
        firstName: "Awa",
        lastName: "Diop",
        matricule: "ELE-AWA",
        schoolId: SCHOOL_ID,
        schoolCode: SCHOOL_CODE,
        className: "6ème A",
      },
      {
        id: STUDENT_B,
        name: "Binta Traoré",
        firstName: "Binta",
        lastName: "Traoré",
        matricule: "ELE-BIN",
        schoolId: SCHOOL_ID,
        schoolCode: SCHOOL_CODE,
        className: "6ème A",
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
    currency: "XOF",
    paymentMethods: [{ label: "Espèces", active: true }],
  });
}

function studentOptionsOk() {
  listPaymentStudentOptions.mockResolvedValue([
    {
      studentId: STUDENT_A,
      firstName: "Awa",
      lastName: "Diop",
      studentCode: "ELE-AWA",
      classId: CLASS_ID,
      classCode: "6A",
      className: "6ème A",
      classes: [{ classId: CLASS_ID, classCode: "6A", className: "6ème A" }],
    },
    {
      studentId: STUDENT_B,
      firstName: "Binta",
      lastName: "Traoré",
      studentCode: "ELE-BIN",
      classId: CLASS_ID,
      classCode: "6A",
      className: "6ème A",
      classes: [{ classId: CLASS_ID, classCode: "6A", className: "6ème A" }],
    },
  ]);
}

function asUser(role: string, permissions: string[]) {
  authState.session.user.role = role;
  authState.session.user.permissions = permissions;
}

async function openPaymentFor(studentId: string) {
  const user = userEvent.setup();
  const buttons = screen.getAllByTestId(`unpaid-register-payment-${studentId}`);
  await user.click(buttons[0]);
  await screen.findByTestId("quick-payment-modal");
  return user;
}

describe("IMP-PAY — Enregistrer un paiement depuis Impayés", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    refresh.mockResolvedValue(undefined);
    createPayment.mockReset();
    listPaymentStudentOptions.mockReset();
    getFinanceCatalog.mockReset();
    listStudentFees.mockReset();
    catalogOk();
    studentOptionsOk();
    listStudentFees.mockResolvedValue([]);
    createPayment.mockResolvedValue({ id: "pay-1", amount: 40_000 });
    asUser("Comptable", ["Impayés:READ", "Paiements:READ", "Paiements:CREATE", "Paiements:UPDATE"]);
    dataState.current = emptyState([
      fee({ id: "obl-sco", studentId: STUDENT_A, label: "Scolarité T1", feeType: "Scolarité" }),
    ]);
  });

  it("IMP-PAY-01 — élève impayé + utilisateur autorisé → bouton visible", () => {
    render(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(`unpaid-register-payment-${STUDENT_A}`)[0]).toHaveTextContent(
      "Enregistrer un paiement",
    );
    expect(screen.queryByRole("button", { name: "Payer" })).not.toBeInTheDocument();
  });

  it("IMP-PAY-02 — Impayés:READ sans droit Paiements → bouton absent", () => {
    asUser("Admin School", ["Impayés:READ"]);
    render(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId(`unpaid-register-payment-${STUDENT_A}`)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Enregistrer un paiement" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Détail" }).length).toBeGreaterThan(0);
  });

  it("IMP-PAY-09 — Paiements:CREATE sans Paiements:READ → bouton absent", () => {
    asUser("Comptable", ["Impayés:READ", "Paiements:CREATE"]);
    render(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);
    expect(screen.queryAllByTestId(`unpaid-register-payment-${STUDENT_A}`)).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Enregistrer un paiement" })).not.toBeInTheDocument();
  });

  it("IMP-PAY-10 — Impayés:READ + Paiements:READ + Paiements:UPDATE → bouton visible", () => {
    asUser("Comptable", ["Impayés:READ", "Paiements:READ", "Paiements:UPDATE"]);
    render(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByTestId(`unpaid-register-payment-${STUDENT_A}`)[0]).toHaveTextContent(
      "Enregistrer un paiement",
    );
  });

  it("IMP-PAY-03 — clic → modal d'encaissement existant + élève préselectionné", async () => {
    listStudentFees.mockResolvedValue([
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        feeType: "Scolarité",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
        periodLabel: "T1",
        className: "6ème A",
      },
    ]);
    render(<RoutedFinanceUnpaidPage />);
    await openPaymentFor(STUDENT_A);
    expect(screen.getByRole("dialog", { name: /Enregistrer un encaissement/i })).toBeInTheDocument();
    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent("Awa Diop");
    expect(within(selected).queryByText("Binta Traoré")).not.toBeInTheDocument();
  });

  it("IMP-PAY-04 — plusieurs obligations ouvertes → uniquement celles de l'élève, pas d'un autre tenant", async () => {
    dataState.current = emptyState([
      fee({ id: "obl-insc", studentId: STUDENT_A, label: "Inscription", feeType: "Inscription", amountDue: 50_000, balance: 50_000, initialAmount: 50_000 }),
      fee({ id: "obl-sco", studentId: STUDENT_A, label: "Scolarité T1", feeType: "Scolarité" }),
      fee({ id: "obl-exam", studentId: STUDENT_A, label: "Examen", feeType: "Examen", amountDue: 15_000, balance: 15_000, initialAmount: 15_000 }),
      fee({ id: "obl-other", studentId: STUDENT_B, label: "Uniforme autre élève", feeType: "Uniforme", amountDue: 20_000, balance: 20_000, initialAmount: 20_000 }),
    ]);
    listStudentFees.mockResolvedValue([
      {
        id: "obl-insc",
        studentId: STUDENT_A,
        label: "Inscription",
        status: "En retard",
        balance: 50_000,
        amountDue: 50_000,
        amountPaid: 0,
        currency: "XOF",
      },
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
      },
      {
        id: "obl-exam",
        studentId: STUDENT_A,
        label: "Examen",
        status: "En retard",
        balance: 15_000,
        amountDue: 15_000,
        amountPaid: 0,
        currency: "XOF",
      },
      {
        id: "obl-other",
        studentId: STUDENT_B,
        label: "Uniforme autre élève",
        status: "En retard",
        balance: 20_000,
        amountDue: 20_000,
        amountPaid: 0,
        currency: "XOF",
      },
      {
        id: "obl-foreign",
        studentId: "stu-foreign-tenant",
        label: "Scolarité tenant B",
        status: "En retard",
        balance: 99_000,
        amountDue: 99_000,
        amountPaid: 0,
        currency: "XOF",
      },
    ]);
    render(<RoutedFinanceUnpaidPage />);
    await openPaymentFor(STUDENT_A);
    const modal = screen.getByTestId("quick-payment-modal");
    expect(within(modal).getByText("Inscription")).toBeInTheDocument();
    expect(within(modal).getByText("Scolarité T1")).toBeInTheDocument();
    expect(within(modal).getByText("Examen")).toBeInTheDocument();
    expect(within(modal).queryByText("Uniforme autre élève")).not.toBeInTheDocument();
    expect(within(modal).queryByText("Scolarité tenant B")).not.toBeInTheDocument();
    expect(within(modal).queryByText("Binta Traoré")).not.toBeInTheDocument();
  });

  it("IMP-PAY-05 — paiement partiel → reste à payer mis à jour, élève toujours dans Impayés", async () => {
    listStudentFees.mockResolvedValue([
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
      },
    ]);
    refresh.mockImplementation(async () => {
      dataState.current = emptyState([
        fee({
          id: "obl-sco",
          studentId: STUDENT_A,
          label: "Scolarité T1",
          feeType: "Scolarité",
          amountPaid: 40_000,
          balance: 60_000,
          status: "Partiellement payé",
        }),
      ]);
    });
    const view = render(<RoutedFinanceUnpaidPage />);
    const user = await openPaymentFor(STUDENT_A);
    const amount = screen.getByLabelText(/Montant à encaisser/i);
    await user.clear(amount);
    await user.type(amount, "40000");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    expect(createPayment.mock.calls[0][0]).toMatchObject({
      studentId: STUDENT_A,
    });
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(showToast).toHaveBeenCalledWith("Paiement enregistré", "success");
    view.rerender(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/60[\s\u202f\u00a0]?000 XOF/).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId(`unpaid-register-payment-${STUDENT_A}`).length).toBeGreaterThan(0);
  });

  it("IMP-PAY-06 — paiement intégral → solde 0, ligne retirée après refresh", async () => {
    listStudentFees.mockResolvedValue([
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
      },
    ]);
    refresh.mockImplementation(async () => {
      dataState.current = emptyState([
        fee({
          id: "obl-sco",
          studentId: STUDENT_A,
          label: "Scolarité T1",
          feeType: "Scolarité",
          amountPaid: 100_000,
          balance: 0,
          status: "Payé",
        }),
      ]);
    });
    const view = render(<RoutedFinanceUnpaidPage />);
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);
    const user = await openPaymentFor(STUDENT_A);
    const amount = screen.getByLabelText(/Montant à encaisser/i);
    await user.clear(amount);
    await user.type(amount, "100000");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    view.rerender(<RoutedFinanceUnpaidPage />);
    expect(screen.queryAllByText("Awa Diop")).toHaveLength(0);
    expect(screen.queryAllByTestId(`unpaid-register-payment-${STUDENT_A}`)).toHaveLength(0);
    expect(screen.getAllByText("Aucun reste à payer").length).toBeGreaterThan(0);
  });

  it("IMP-PAY-07 — échec API → aucune mutation locale, erreur, retry possible", async () => {
    listStudentFees.mockResolvedValue([
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
      },
    ]);
    createPayment.mockRejectedValueOnce(new Error("FINANCE_PAYMENT_REJECTED"));
    const snapshot = structuredClone(dataState.current.studentFees);
    render(<RoutedFinanceUnpaidPage />);
    const user = await openPaymentFor(STUDENT_A);
    const amount = screen.getByLabelText(/Montant à encaisser/i);
    await user.clear(amount);
    await user.type(amount, "40000");
    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith("FINANCE_PAYMENT_REJECTED", "error"),
    );
    expect(refresh).not.toHaveBeenCalled();
    expect(dataState.current.studentFees).toEqual(snapshot);
    expect(screen.getByTestId("quick-payment-modal")).toBeInTheDocument();
    expect(screen.getAllByText("Awa Diop").length).toBeGreaterThan(0);

    createPayment.mockResolvedValueOnce({ id: "pay-retry", amount: 40_000 });
    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(2));
  });

  it("IMP-PAY-08 — double clic / retry → une seule intention idempotente", async () => {
    listStudentFees.mockResolvedValue([
      {
        id: "obl-sco",
        studentId: STUDENT_A,
        label: "Scolarité T1",
        status: "En retard",
        balance: 100_000,
        amountDue: 100_000,
        amountPaid: 0,
        currency: "XOF",
      },
    ]);
    let release: () => void = () => undefined;
    createPayment.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ id: "pay-1", amount: 40_000 });
        }),
    );
    render(<RoutedFinanceUnpaidPage />);
    const user = await openPaymentFor(STUDENT_A);
    const amount = screen.getByLabelText(/Montant à encaisser/i);
    await user.clear(amount);
    await user.type(amount, "40000");
    const submit = screen.getByRole("button", { name: "Enregistrer l'encaissement" });
    fireEvent.click(submit);
    fireEvent.click(submit);
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    const options = createPayment.mock.calls[0][1] as { idempotencyKey?: string };
    expect(options.idempotencyKey).toEqual(expect.any(String));
    expect(String(options.idempotencyKey).length).toBeGreaterThan(8);
    release();
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("Paiement enregistré", "success"));
  });
});
