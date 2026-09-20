/**
 * P1 — QuickPaymentModal consomme le roster API payment-student-options.
 * Un élève `enrolled` retourné par l'API est trouvable par nom / matricule.
 * « Aucun élève trouvé » uniquement si l'API n'a réellement aucun match.
 * Aucun fallback vers state.students legacy.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackOfficeState, SessionUser } from "../../types";
import { QuickPaymentModal } from "./QuickPaymentModal";
import { SCHOOL_CODE, paymentStudentOptionRow } from "../../lib/financeStudentIdentity.fixtures";

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
const createPayment = vi.hoisted(() => vi.fn());
const listPaymentStudentOptions = vi.hoisted(() => vi.fn());
const getFinanceCatalog = vi.hoisted(() => vi.fn());
const listStudentFees = vi.hoisted(() => vi.fn());

const ESTHER = paymentStudentOptionRow({
  studentId: "dddddddd-4444-4444-8444-dddddddddddd",
  studentCode: "CD-IN-26-ESTHER",
  firstName: "Esther",
  lastName: "OKITO",
  enrollmentStatus: "enrolled",
  classId: "class-1pa",
  classCode: "1PA",
  className: "1ère Primaire A",
  schoolCode: SCHOOL_CODE,
  classes: [{ classId: "class-1pa", classCode: "1PA", className: "1ère Primaire A" }],
});

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

async function openEncaissementModal() {
  render(<QuickPaymentModal open onClose={() => undefined} />);
  await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());
}

describe("P1 — QuickPaymentModal roster API enrolled", () => {
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
    listStudentFees.mockResolvedValue([]);
    createPayment.mockResolvedValue({ id: "pay-esther", amount: 25_000 });
    dataState.current = {
      ...dataState.current,
      students: [
        {
          id: "legacy-esther",
          firstName: "Esther",
          lastName: "OKITO",
          studentCode: "LEGACY-ESTHER",
          name: "Esther OKITO",
          className: "1ère Primaire A",
          schoolCode: SCHOOL_CODE,
        } as never,
      ],
    };
  });

  it("trouve l'élève enrolled retourné par l'API par nom et par matricule", async () => {
    listPaymentStudentOptions.mockResolvedValue([ESTHER]);
    const user = userEvent.setup();
    await openEncaissementModal();

    const search = screen.getByTestId("payment-student-search");
    await user.type(search, "Esther");
    expect(screen.getByText("Esther OKITO")).toBeInTheDocument();
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "CD-IN-26-ESTHER");
    expect(screen.getByText("Esther OKITO")).toBeInTheDocument();
    expect(screen.getByText(/1ère Primaire A · CD-IN-26-ESTHER/i)).toBeInTheDocument();
  });

  it("affiche Aucun élève trouvé seulement si l'API n'a aucun match — pas de fallback legacy", async () => {
    listPaymentStudentOptions.mockResolvedValue([]);
    const user = userEvent.setup();
    await openEncaissementModal();

    const search = screen.getByTestId("payment-student-search");
    await user.type(search, "Esther");
    expect(screen.getByText(/Aucun élève trouvé/i)).toBeInTheDocument();
    expect(screen.queryByText("Esther OKITO")).not.toBeInTheDocument();
  });
});
