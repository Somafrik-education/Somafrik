/**
 * FIN-REG-02 — Impayés → encaissement.
 * La liste des élèves, le catalogue et les obligations se chargent séparément.
 * Un échec ou un délai du catalogue ne vide pas le roster et ne s'affiche pas
 * comme « Aucun élève trouvé ».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackOfficeState, SessionUser } from "../../types";
import { QuickPaymentModal } from "./QuickPaymentModal";
import {
  CLASS_NAME,
  OBLIGATION_INSC_ID,
  SCHOOL_CODE,
  STUDENT_CODE,
  STUDENT_FIRST_NAME,
  STUDENT_LAST_NAME,
  STUDENT_NAME,
  STUDENT_UUID,
  paymentStudentOptionRow,
  postgresObligationRow,
} from "../../lib/financeStudentIdentity.fixtures";
import { L308_FOREIGN, L308_HOMONYM_B } from "../../lib/financeL308PaymentStudent.fixture";

const showToast = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn(async () => undefined));
const createPayment = vi.hoisted(() => vi.fn());
const listPaymentStudentOptions = vi.hoisted(() => vi.fn());
const getFinanceCatalog = vi.hoisted(() => vi.fn());
const listStudentFees = vi.hoisted(() => vi.fn());

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

const readyCatalog = {
  currency: "CDF",
  paymentMethods: [{ label: "Espèces", active: true }],
};

describe("FIN-REG-02 — recherche élève depuis Impayés", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    createPayment.mockReset();
    listPaymentStudentOptions.mockReset();
    getFinanceCatalog.mockReset();
    listStudentFees.mockReset();
    getFinanceCatalog.mockResolvedValue(readyCatalog);
    listPaymentStudentOptions.mockResolvedValue([paymentStudentOptionRow(), L308_HOMONYM_B, L308_FOREIGN]);
    listStudentFees.mockResolvedValue([postgresObligationRow()]);
    createPayment.mockResolvedValue({ id: "pay-reg-02", amount: 40_000 });
  });

  it("présélectionne l'élève Impayés par UUID et masque la recherche", async () => {
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={STUDENT_UUID}
        onClose={() => undefined}
      />,
    );

    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(selected).toHaveTextContent(STUDENT_CODE);
    expect(selected).toHaveTextContent(CLASS_NAME);
    expect(screen.queryByTestId("payment-student-search")).not.toBeInTheDocument();
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();
  });

  it("présélectionne par matricule quand l'identifiant Impayés n'est pas l'UUID roster", async () => {
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId="profile-elie-not-in-roster"
        initialStudentCode={STUDENT_CODE}
        onClose={() => undefined}
      />,
    );

    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(selected).toHaveTextContent(STUDENT_CODE);
    expect(screen.queryByTestId("payment-student-search")).not.toBeInTheDocument();
  });

  it("affiche un élève introuvable sans le confondre avec une recherche vide", async () => {
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId="absent-de-cet-etablissement"
        initialStudentCode="CD-IN-ME-26-00010"
        onClose={() => undefined}
      />,
    );

    expect(await screen.findByTestId("payment-student-unresolved")).toHaveTextContent(
      /introuvable pour l'encaissement/i,
    );
    await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-student-search")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("affiche l'élève avant la réponse du catalogue et bloque l'encaissement tant que le catalogue manque", async () => {
    const catalog = deferred<typeof readyCatalog>();
    getFinanceCatalog.mockReturnValue(catalog.promise);

    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={STUDENT_CODE}
        onClose={() => undefined}
      />,
    );

    const selected = await screen.findByTestId("quick-payment-selected-student");
    expect(selected).toHaveTextContent(STUDENT_NAME);
    expect(screen.getByText(/Chargement du catalogue financier/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'encaissement" })).toBeDisabled();
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();

    catalog.resolve(readyCatalog);
    await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());
    expect(screen.getByTestId("quick-payment-selected-student")).toHaveTextContent(STUDENT_NAME);
    expect(screen.getByRole("button", { name: "Enregistrer l'encaissement" })).toBeEnabled();
  });

  it("conserve la présélection si le catalogue échoue", async () => {
    getFinanceCatalog.mockRejectedValue(new Error("Catalogue financier indisponible."));

    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={STUDENT_UUID}
        onClose={() => undefined}
      />,
    );

    expect(await screen.findByTestId("quick-payment-selected-student")).toHaveTextContent(STUDENT_NAME);
    expect(await screen.findByText(/Catalogue financier indisponible/i)).toBeInTheDocument();
    expect(screen.queryByTestId("payment-students-error")).not.toBeInTheDocument();
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'encaissement" })).toBeDisabled();
  });

  it("présélectionne même sans moyen de paiement actif", async () => {
    getFinanceCatalog.mockResolvedValue({ currency: "CDF", paymentMethods: [] });

    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={STUDENT_UUID}
        onClose={() => undefined}
      />,
    );

    expect(await screen.findByTestId("quick-payment-selected-student")).toHaveTextContent(STUDENT_NAME);
    expect(await screen.findByText(/Aucun moyen de paiement actif/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer l'encaissement" })).toBeDisabled();
  });

  it("affiche une erreur de liste et jamais « Aucun élève trouvé » si le roster échoue", async () => {
    listPaymentStudentOptions.mockRejectedValue(new Error("Failed to fetch"));
    const user = userEvent.setup();
    render(<QuickPaymentModal open onClose={() => undefined} />);

    expect(await screen.findByTestId("payment-students-error")).toHaveTextContent(
      /Impossible de charger la liste des élèves/i,
    );
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();

    await user.type(screen.getByTestId("payment-student-search"), STUDENT_LAST_NAME);
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-students-error")).toBeInTheDocument();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("retrouve un élève de l'établissement par prénom, nom et matricule, pas un élève étranger", async () => {
    const user = userEvent.setup();
    render(<QuickPaymentModal open onClose={() => undefined} />);
    await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());
    const search = screen.getByTestId("payment-student-search");

    await user.type(search, STUDENT_FIRST_NAME);
    expect(screen.getByRole("button", { name: new RegExp(STUDENT_NAME) })).toBeInTheDocument();
    expect(screen.queryByText(/Étranger/i)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Numerique");
    expect(screen.getByRole("button", { name: new RegExp(STUDENT_NAME) })).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, STUDENT_CODE);
    expect(screen.getByRole("button", { name: new RegExp(STUDENT_NAME) })).toBeInTheDocument();
    expect(screen.queryByText(/Aucun élève trouvé/i)).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "Intru");
    expect(screen.getByText(/Aucun élève trouvé/i)).toBeInTheDocument();
    expect(screen.queryByText(/Étranger/i)).not.toBeInTheDocument();
  });

  it("un échec des obligations ne vide pas le roster ni n'affiche une erreur catalogue", async () => {
    listStudentFees.mockImplementation((studentId?: string) => {
      if (!studentId) return Promise.reject(new Error("obligations indisponibles"));
      return Promise.resolve([postgresObligationRow()]);
    });
    const user = userEvent.setup();
    render(<QuickPaymentModal open onClose={() => undefined} />);
    await waitFor(() => expect(screen.queryByText(/Chargement du catalogue financier/i)).not.toBeInTheDocument());

    expect(screen.queryByText(/Catalogue financier indisponible/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("payment-students-error")).not.toBeInTheDocument();

    await user.type(screen.getByTestId("payment-student-search"), STUDENT_CODE);
    await user.click(await screen.findByRole("button", { name: new RegExp(STUDENT_NAME) }));
    expect(await screen.findByTestId("quick-payment-selected-student")).toHaveTextContent(STUDENT_NAME);
    expect(screen.getByText("Scolarité T1")).toBeInTheDocument();
  });

  it("affiche plusieurs obligations du même élève après présélection", async () => {
    listStudentFees.mockResolvedValue([
      postgresObligationRow(),
      postgresObligationRow({
        id: OBLIGATION_INSC_ID,
        obligationId: OBLIGATION_INSC_ID,
        label: "Inscription",
        feeType: "Inscription",
        balance: 50_000,
        amountDue: 50_000,
      }),
    ]);

    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={STUDENT_UUID}
        onClose={() => undefined}
      />,
    );

    const modal = await screen.findByTestId("quick-payment-modal");
    expect(await screen.findByTestId("quick-payment-selected-student")).toHaveTextContent(STUDENT_NAME);
    expect(modal).toHaveTextContent("Scolarité T1");
    expect(modal).toHaveTextContent("Inscription");
    expect(screen.getByTestId("payment-add-line")).toBeEnabled();
  });
});
