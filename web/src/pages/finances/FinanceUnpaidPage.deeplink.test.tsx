/**
 * DEEPLINK-IMPAYE — `/finances/impayes?obligationId=…` doit ouvrir le détail de
 * l'élève concerné et mettre en évidence l'obligation visée.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { BackOfficeState, SessionUser, StudentFee } from "../../types";
import { FinanceUnpaidPage } from "./FinanceUnpaidPage";

const SCHOOL_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHOOL_CODE = "CD-IN-26-001";
const STUDENT_A = "stu-awa";
const STUDENT_B = "stu-binta";

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn(async () => undefined));

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

vi.mock("../../components/ui/Toast", () => ({ useToast: () => ({ showToast }) }));
vi.mock("../../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

vi.mock("../../lib/financeApi", () => ({
  financeApi: {
    createPayment: vi.fn(),
    listPaymentStudentOptions: vi.fn().mockResolvedValue([]),
    getFinanceCatalog: vi.fn().mockResolvedValue({ currency: "XOF", paymentMethods: [] }),
    listStudentFees: vi.fn(),
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
  } as StudentFee;
}

function stateWith(fees: StudentFee[]): BackOfficeState {
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
  } as unknown as BackOfficeState;
}

function renderPage(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/finances/impayes${search}`]}>
      <FinanceUnpaidPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dataState.current = stateWith([
    fee({ id: "obl-awa", studentId: STUDENT_A, label: "Scolarité T1 Awa" }),
    fee({ id: "obl-binta", studentId: STUDENT_B, label: "Scolarité T1 Binta" }),
    fee({ id: "obl-binta-2", studentId: STUDENT_B, label: "Cantine T1 Binta", feeType: "Cantine" }),
  ]);
});

describe("DEEPLINK-IMPAYE — la page Impayés consomme obligationId", () => {
  it("DEEPLINK-IMPAYE-01 — l'obligation visée ouvre le détail de son élève", async () => {
    renderPage("?obligationId=obl-binta-2");

    expect(await screen.findByText("Impayé — Binta Traoré")).toBeInTheDocument();
    const rows = await screen.findAllByTestId("unpaid-obligation");
    const selected = rows.filter((row) => row.getAttribute("data-selected") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]).toHaveAttribute("data-obligation-id", "obl-binta-2");
    expect(selected[0]).toHaveTextContent("Cantine T1 Binta");
  });

  it("DEEPLINK-IMPAYE-02 — sans paramètre, aucun détail n'est ouvert d'office", async () => {
    renderPage("");
    await waitFor(() => expect(screen.getAllByText("Binta Traoré").length).toBeGreaterThan(0));
    expect(screen.queryByText("Impayé — Binta Traoré")).toBeNull();
    expect(screen.queryByTestId("unpaid-obligation")).toBeNull();
  });

  it("DEEPLINK-IMPAYE-03 — une obligation hors périmètre autorisé n'ouvre aucun détail", async () => {
    renderPage("?obligationId=obl-autre-ecole");
    await waitFor(() => expect(screen.getAllByText("Binta Traoré").length).toBeGreaterThan(0));
    expect(screen.queryByText("Impayé — Binta Traoré")).toBeNull();
    expect(screen.queryByText("Impayé — Awa Diop")).toBeNull();
  });
});
