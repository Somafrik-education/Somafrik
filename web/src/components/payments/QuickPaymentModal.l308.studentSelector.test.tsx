/**
 * FIN-L3-08 RED-WEB — sélecteur Élève de « Enregistrer un encaissement ».
 *
 * Cause visée : le flatten du catalogue tamponne schoolCode session sur
 * toutes les options, donc un élève d'un autre établissement présent dans
 * le payload (défense en profondeur) reste recherchable et soumissible.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackOfficeState, SessionUser } from "../../types";
import { QuickPaymentModal } from "./QuickPaymentModal";
import { SCHOOL_CODE } from "../../lib/financeStudentIdentity.fixtures";
import {
  L308_AMOUNT,
  L308_FOREIGN,
  L308_HOMONYM_A,
  L308_HOMONYM_B,
} from "../../lib/financeL308PaymentStudent.fixture";

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
    schools: [
      { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", code: "CD-IN-26-001", name: "Lycée Test", currency: "CDF" },
    ],
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

describe("FIN-L3-08 RED-WEB — sélecteur Élève Enregistrer un encaissement", () => {
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
    listPaymentStudentOptions.mockResolvedValue([L308_HOMONYM_A, L308_HOMONYM_B, L308_FOREIGN]);
    listStudentFees.mockResolvedValue([]);
    createPayment.mockResolvedValue({ id: "pay-l308", amount: L308_AMOUNT, studentId: L308_HOMONYM_A.studentId });
  });

  it("FIN-L3-08-W-TENANT — un élève d'un autre établissement n'apparaît pas et n'est pas soumissible", async () => {
    const user = userEvent.setup();
    await openEncaissementModal();

    const search = screen.getByTestId("payment-student-search");
    await user.type(search, "Intru");

    expect(screen.queryByText(/Étranger/i)).not.toBeInTheDocument();
    expect(screen.getByText(/Aucun élève trouvé/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Enregistrer l'encaissement/i }));
    expect(createPayment).not.toHaveBeenCalled();
  });
});
