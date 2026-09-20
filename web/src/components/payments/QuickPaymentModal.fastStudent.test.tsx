import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import type { BackOfficeState, SessionUser } from "../../types";
import { QuickPaymentModal } from "./QuickPaymentModal";
import {
  CLASS_NAME,
  ESTHER_CLASS_NAME,
  ESTHER_CODE,
  ESTHER_NAME,
  ESTHER_UUID,
  OBLIGATION_SCO_ID,
  OPEN_BALANCE_CDF,
  SCHOOL_CODE,
  STUDENT_CODE,
  STUDENT_NAME,
  STUDENT_UUID,
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
      permissions: ["Paiements:READ", "Paiements:CREATE"],
    } as SessionUser,
    accessToken: "test-token",
  },
}));

const dataState = vi.hoisted(() => ({
  current: {
    schools: [{ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "CD-IN-26-001", name: "Lycée Test", currency: "CDF" }],
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
  } as unknown as BackOfficeState,
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

vi.mock("../ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    createPayment,
    listPaymentStudentOptions,
    getFinanceCatalog,
    listStudentFees,
  },
}));

describe("IMP-FAST — QuickPaymentModal contrat UUID ↔ code public", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    createPayment.mockReset();
    listPaymentStudentOptions.mockReset();
    getFinanceCatalog.mockReset();
    listStudentFees.mockReset();
    getFinanceCatalog.mockResolvedValue({
      currency: "CDF",
      paymentMethods: [{ label: "Espèces", active: true }],
    });
    listPaymentStudentOptions.mockResolvedValue([paymentStudentOptionRow()]);
    listStudentFees.mockResolvedValue([postgresObligationRow()]);
    createPayment.mockResolvedValue({ id: "pay-1", amount: 40_000 });
  });

  it("IMP-FAST-RED-02 — options.studentId UUID + fees.studentId code public + fees.studentDbId UUID → obligation ouverte retrouvée", async () => {
    render(<QuickPaymentModal open onClose={() => undefined} initialStudentId={STUDENT_UUID} />);
    const modal = await screen.findByTestId("quick-payment-modal");
    await waitFor(() => expect(screen.getByTestId("quick-payment-selected-student")).toBeInTheDocument());

    expect(listPaymentStudentOptions.mock.results[0]).toBeTruthy();
    const options = await listPaymentStudentOptions.mock.results[0].value;
    const fees = await listStudentFees.mock.results[0].value;
    expect(options[0].studentId).toBe(STUDENT_UUID);
    expect(options[0].studentCode).toBe(STUDENT_CODE);
    expect(fees[0].studentId).toBe(STUDENT_CODE);
    expect(fees[0].studentDbId).toBe(STUDENT_UUID);
    expect(fees[0].balance).toBe(OPEN_BALANCE_CDF);

    expect(modal).toHaveTextContent("Scolarité T1");
    expect(modal).toHaveTextContent(/140[\s\u202f\u00a0]?000 CDF/);
    expect(screen.queryByText(/Aucune obligation ouverte/i)).not.toBeInTheDocument();

    const feeSelect = screen.getByLabelText(/Frais concerné/i) as HTMLSelectElement;
    expect(feeSelect.value).toBe(OBLIGATION_SCO_ID);
    expect(feeSelect.value).not.toBe("__unallocated__");
  });

  it("IMP-FAST-RED-04 — initialStudentId code public vs options UUID → élève préselectionné", async () => {
    render(<QuickPaymentModal open onClose={() => undefined} initialStudentId={STUDENT_CODE} />);
    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(selected).toHaveTextContent(STUDENT_CODE);
    expect(selected).toHaveTextContent(CLASS_NAME);
  });

  it("P1-ESTHER — Esther OKITO sélectionnée ⇒ obligations ouvertes, pas Non imputé", async () => {
    listPaymentStudentOptions.mockResolvedValue([
      paymentStudentOptionRow({
        studentId: ESTHER_UUID,
        studentCode: ESTHER_CODE,
        firstName: "Esther",
        lastName: "OKITO",
        className: ESTHER_CLASS_NAME,
        classes: [{ classId: "class-1pa", classCode: "1PA", className: ESTHER_CLASS_NAME }],
      }),
    ]);
    listStudentFees.mockResolvedValue([
      postgresObligationRow({
        studentId: ESTHER_CODE,
        studentDbId: ESTHER_UUID,
        className: ESTHER_CLASS_NAME,
      }),
      postgresObligationRow({
        id: "obl-esther-paid",
        obligationId: "obl-esther-paid",
        studentId: ESTHER_CODE,
        studentDbId: ESTHER_UUID,
        label: "Uniforme",
        feeType: "Uniforme",
        status: "Payé",
        amountDue: 15_000,
        amountPaid: 15_000,
        balance: 0,
      }),
    ]);

    render(<QuickPaymentModal open onClose={() => undefined} initialStudentId={ESTHER_UUID} />);
    const modal = await screen.findByTestId("quick-payment-modal");
    await waitFor(() => expect(screen.getByTestId("quick-payment-selected-student")).toHaveTextContent(ESTHER_NAME));
    expect(screen.getByTestId("quick-payment-selected-student")).toHaveTextContent(ESTHER_CODE);
    expect(modal).toHaveTextContent("Scolarité T1");
    expect(screen.queryByText(/Aucune obligation ouverte/i)).not.toBeInTheDocument();
    const feeSelect = screen.getByLabelText(/Frais concerné/i) as HTMLSelectElement;
    expect(feeSelect.value).toBe(OBLIGATION_SCO_ID);
    expect(feeSelect.value).not.toBe("__unallocated__");
    expect(within(feeSelect).queryByRole("option", { name: /Uniforme/i })).not.toBeInTheDocument();
  });

  it("P1-ESTHER — élève sans obligation ⇒ Non imputé uniquement", async () => {
    listStudentFees.mockResolvedValue([]);
    render(<QuickPaymentModal open onClose={() => undefined} initialStudentId={STUDENT_UUID} />);
    const modal = await screen.findByTestId("quick-payment-modal");
    await waitFor(() => expect(screen.getByTestId("quick-payment-selected-student")).toBeInTheDocument());
    expect(modal).toHaveTextContent(/Aucune obligation ouverte/i);
    const feeSelect = screen.getByLabelText(/Frais concerné/i) as HTMLSelectElement;
    expect(feeSelect.value).toBe("__unallocated__");
  });

  it("IMP-FAST-GREEN-11 — QuickPaymentModal standard (Paiements) conserve la recherche élève", async () => {
    render(<QuickPaymentModal open onClose={() => undefined} />);
    const modal = await screen.findByTestId("quick-payment-modal");
    await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());
    expect(screen.getByTestId("payment-student-search")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Nom, matricule ou code élève/i)).toBeInTheDocument();
    expect(screen.getByText(/Saisissez au moins 2 caractères pour retrouver un élève inscrit/i)).toBeInTheDocument();
    expect(screen.queryByTestId("quick-payment-selected-student")).not.toBeInTheDocument();
    expect(modal).toHaveTextContent("Affectation de l'encaissement");
    expect(screen.getByTestId("payment-add-line")).toBeInTheDocument();
  });
});
