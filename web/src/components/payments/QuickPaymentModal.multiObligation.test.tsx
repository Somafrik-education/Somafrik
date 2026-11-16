/**
 * FIN-REG-01 — un élève, plusieurs obligations, un seul reçu.
 * Le parcours Impayés (quick-student) doit à nouveau proposer « Ajouter une obligation ».
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BackOfficeState, SessionUser } from "../../types";
import { QuickPaymentModal } from "./QuickPaymentModal";
import {
  ESTHER_CLASS_ID,
  ESTHER_CLASS_NAME,
  ESTHER_CODE,
  ESTHER_NAME,
  ESTHER_UUID,
  OTHER_STUDENT_CODE,
  OTHER_STUDENT_UUID,
  SCHOOL_CODE,
  paymentStudentOptionRow,
  postgresObligationRow,
} from "../../lib/financeStudentIdentity.fixtures";

const MIN_ID = "obl-min";
const EXAM_ID = "obl-exam";
const CAN_ID = "obl-can";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function estherOption() {
  return paymentStudentOptionRow({
    studentId: ESTHER_UUID,
    studentCode: ESTHER_CODE,
    firstName: "Esther",
    lastName: "OKITO",
    classId: ESTHER_CLASS_ID,
    classCode: "1PA",
    className: ESTHER_CLASS_NAME,
    classes: [{ classId: ESTHER_CLASS_ID, classCode: "1PA", className: ESTHER_CLASS_NAME }],
  });
}

function obligation(
  id: string,
  label: string,
  feeType: string,
  balance: number,
  student: { code: string; uuid: string } = { code: ESTHER_CODE, uuid: ESTHER_UUID },
) {
  return postgresObligationRow({
    id,
    obligationId: id,
    studentId: student.code,
    studentDbId: student.uuid,
    label,
    feeType,
    status: "À payer",
    amountDue: balance,
    amountPaid: 0,
    balance,
    periodLabel: "",
    className: ESTHER_CLASS_NAME,
    classId: ESTHER_CLASS_ID,
    currency: "CDF",
  });
}

const estherFees = [
  obligation(MIN_ID, "Minerval", "Scolarité", 1_000),
  obligation(EXAM_ID, "Examen", "Examen", 10),
  obligation(CAN_ID, "Cantine", "Cantine", 100),
];

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

function echoPayment(payload: {
  items?: Array<{ feeLabel?: string; amount?: number }>;
  paymentMethod?: string;
  paidAt?: string;
  comment?: string;
}) {
  const amount = (payload.items ?? []).reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  return {
    id: "pay-multi",
    reference: "CD-IN-26-001-2026-PAY-0041",
    studentName: ESTHER_NAME,
    className: ESTHER_CLASS_NAME,
    amount,
    totalAmount: amount,
    allocatedAmount: amount,
    unallocatedAmount: 0,
    currency: "CDF",
    method: payload.paymentMethod,
    date: payload.paidAt,
    status: "Partiel",
    comment: payload.comment,
    items: payload.items ?? [],
  };
}

async function openQuickStudent(fees = [...estherFees, obligation("obl-foreign", "Frais étranger", "Transport", 9_999, { code: OTHER_STUDENT_CODE, uuid: OTHER_STUDENT_UUID })]) {
  listStudentFees.mockResolvedValue(fees);
  render(
    <QuickPaymentModal
      open
      mode="quick-student"
      initialStudentId={ESTHER_UUID}
      onClose={() => undefined}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("quick-payment-selected-student")).toHaveTextContent(ESTHER_NAME));
  await waitFor(() => expect(screen.getByTestId("payment-add-line")).toBeInTheDocument());
  return screen.getByTestId("quick-payment-modal");
}

async function choose(line: HTMLElement, obligationId: string) {
  const user = userEvent.setup();
  await user.selectOptions(within(line).getByLabelText(/Frais concerné/i), obligationId);
}

async function typeAmount(line: HTMLElement, value: string) {
  const user = userEvent.setup();
  const input = within(line).getByLabelText(/Montant à encaisser/i);
  await user.clear(input);
  if (value) await user.type(input, value);
}

describe("FIN-REG-01 — encaissement multi-obligations", () => {
  beforeEach(() => {
    showToast.mockReset();
    refresh.mockReset();
    createPayment.mockReset();
    listPaymentStudentOptions.mockReset();
    getFinanceCatalog.mockReset();
    listStudentFees.mockReset();
    window.print = vi.fn();
    getFinanceCatalog.mockResolvedValue({
      currency: "CDF",
      paymentMethods: [{ label: "Espèces", active: true }],
    });
    listPaymentStudentOptions.mockResolvedValue([estherOption()]);
    createPayment.mockImplementation(async (payload) => echoPayment(payload));
  });

  it("restaure « Ajouter une obligation » sur le parcours Impayés et isole l'élève", async () => {
    const modal = await openQuickStudent();
    const add = screen.getByRole("button", { name: "Ajouter une obligation" });
    expect(add).toBeEnabled();
    expect(modal).not.toHaveTextContent("Frais étranger");
    expect(screen.getByTestId("payment-line-balance-0")).toHaveValue("—");
    expect(screen.queryByTestId("payment-student-search")).not.toBeInTheDocument();
  });

  it("encaisse une obligation et produit un reçu", async () => {
    const onSaved = vi.fn();
    listStudentFees.mockResolvedValue([obligation(MIN_ID, "Minerval", "Scolarité", 1_000)]);
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={ESTHER_UUID}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText(/Frais concerné/i)).toHaveValue(MIN_ID));
    expect(screen.getByTestId("payment-add-line")).toBeDisabled();
    expect((screen.getByTestId("payment-line-balance-0") as HTMLInputElement).value).toMatch(/1[\s\u202f\u00a0]?000 CDF/);
    await typeAmount(screen.getByTestId("payment-line-0"), "1000");
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    const [payload, options] = createPayment.mock.calls[0];
    expect(payload.items).toEqual([
      expect.objectContaining({ obligationId: MIN_ID, amount: 1000, feeLabel: "Minerval" }),
    ]);
    expect(payload.paymentMethod).toBe("Espèces");
    expect(payload.paidAt).toEqual(expect.any(String));
    expect(payload).not.toHaveProperty("totalAmount");
    expect(options.idempotencyKey).toEqual(expect.any(String));
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  it("encaisse trois obligations partielles sur un reçu unique, avec détail et total", async () => {
    const onSaved = vi.fn();
    listStudentFees.mockResolvedValue(estherFees);
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={ESTHER_UUID}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(screen.getByTestId("payment-add-line")).toBeEnabled());
    const user = userEvent.setup();
    await choose(screen.getByTestId("payment-line-0"), MIN_ID);
    expect((screen.getByTestId("payment-line-balance-0") as HTMLInputElement).value).toMatch(/1[\s\u202f\u00a0]?000 CDF/);
    await user.click(screen.getByRole("button", { name: "Ajouter une obligation" }));
    await choose(screen.getByTestId("payment-line-1"), EXAM_ID);
    expect(within(screen.getByTestId("payment-line-1")).queryByRole("option", { name: /Minerval/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Ajouter une obligation" }));
    await waitFor(() => expect(screen.getByTestId("payment-line-2")).toBeInTheDocument());
    expect((screen.getByTestId("payment-line-2").querySelector("select") as HTMLSelectElement).value).toBe(CAN_ID);
    expect(screen.getByTestId("payment-add-line")).toBeDisabled();

    await typeAmount(screen.getByTestId("payment-line-0"), "500");
    await typeAmount(screen.getByTestId("payment-line-1"), "1");
    await typeAmount(screen.getByTestId("payment-line-2"), "40");
    await user.type(screen.getByLabelText(/Commentaire/i), "Reçu unique");
    expect(screen.getByTestId("payment-total")).toHaveTextContent(/541 CDF/);

    await user.click(screen.getByRole("button", { name: "Enregistrer et imprimer" }));
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    const [payload] = createPayment.mock.calls[0];
    expect(payload.items).toEqual([
      expect.objectContaining({ obligationId: MIN_ID, amount: 500 }),
      expect.objectContaining({ obligationId: EXAM_ID, amount: 1 }),
      expect.objectContaining({ obligationId: CAN_ID, amount: 40 }),
    ]);
    expect(payload.paymentMethod).toBe("Espèces");
    expect(payload.comment).toBe("Reçu unique");
    expect(payload.paidAt).toEqual(expect.any(String));
    expect(onSaved).toHaveBeenCalledTimes(1);

    expect(await screen.findByRole("heading", { name: "Reçu de paiement" })).toBeInTheDocument();
    expect(screen.getByText("Minerval")).toBeInTheDocument();
    expect(screen.getByText("Examen")).toBeInTheDocument();
    expect(screen.getByText("Cantine")).toBeInTheDocument();
    expect(screen.getByText("CD-IN-26-001-2026-PAY-0041")).toBeInTheDocument();
    expect(screen.getAllByText("541 CDF").length).toBeGreaterThan(0);
    expect(screen.getByText("Reçu unique")).toBeInTheDocument();
    await waitFor(() => expect(window.print).toHaveBeenCalled());
  });

  it("ajoute puis retire une ligne sans perdre le mode de paiement commun", async () => {
    await openQuickStudent(estherFees);
    const user = userEvent.setup();
    await choose(screen.getByTestId("payment-line-0"), MIN_ID);
    await user.click(screen.getByRole("button", { name: "Ajouter une obligation" }));
    expect(screen.getByTestId("payment-line-1")).toBeInTheDocument();
    await user.click(within(screen.getByTestId("payment-line-1")).getByRole("button", { name: "Supprimer la ligne" }));
    expect(screen.queryByTestId("payment-line-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("payment-add-line")).toBeEnabled();
    expect(screen.getByLabelText(/Mode de paiement/i)).toHaveValue("Espèces");
    expect(screen.getByLabelText(/Date d'encaissement/i)).toHaveTextContent(/\d{2}-\d{2}-\d{4}/);
  });

  it("refuse un montant supérieur au solde de la ligne même si le total reste sous le solde global", async () => {
    await openQuickStudent([
      obligation(MIN_ID, "Minerval", "Scolarité", 100),
      obligation(EXAM_ID, "Examen", "Examen", 1_000),
    ]);
    const user = userEvent.setup();
    await choose(screen.getByTestId("payment-line-0"), MIN_ID);
    await user.click(screen.getByRole("button", { name: "Ajouter une obligation" }));
    await waitFor(() => expect((screen.getByTestId("payment-line-1").querySelector("select") as HTMLSelectElement).value).toBe(EXAM_ID));
    await typeAmount(screen.getByTestId("payment-line-0"), "150");
    await typeAmount(screen.getByTestId("payment-line-1"), "10");
    expect(screen.getByTestId("payment-line-exceeds-0")).toHaveTextContent(/dépasse le solde encore dû/i);
    expect(screen.getByRole("button", { name: "Enregistrer l'encaissement" })).toBeDisabled();
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("refuse un montant nul ou négatif avant tout appel API", async () => {
    listStudentFees.mockResolvedValue([obligation(MIN_ID, "Minerval", "Scolarité", 1_000)]);
    render(<QuickPaymentModal open mode="quick-student" initialStudentId={ESTHER_UUID} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByLabelText(/Frais concerné/i)).toHaveValue(MIN_ID));
    const amount = screen.getByLabelText(/Montant à encaisser/i);
    fireEvent.change(amount, { target: { value: "0" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/strictement positif/i), "error"));
    expect(createPayment).not.toHaveBeenCalled();

    showToast.mockClear();
    fireEvent.change(amount, { target: { value: "-5" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/strictement positif/i), "error"));
    expect(createPayment).not.toHaveBeenCalled();
  });

  it("un double clic n'enregistre qu'un encaissement", async () => {
    const pending = deferred<ReturnType<typeof echoPayment>>();
    createPayment.mockImplementation(() => pending.promise);
    listStudentFees.mockResolvedValue([obligation(MIN_ID, "Minerval", "Scolarité", 1_000)]);
    const onSaved = vi.fn();
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={ESTHER_UUID}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText(/Frais concerné/i)).toHaveValue(MIN_ID));
    fireEvent.change(screen.getByLabelText(/Montant à encaisser/i), { target: { value: "100" } });
    const save = screen.getByRole("button", { name: "Enregistrer l'encaissement" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(1));
    pending.resolve(echoPayment({ items: [{ feeLabel: "Minerval", amount: 100 }], paymentMethod: "Espèces" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
  });

  it("un nouvel essai après une erreur réseau réutilise la même clé d'idempotence", async () => {
    createPayment.mockRejectedValueOnce(new Error("réseau"));
    listStudentFees.mockResolvedValue([obligation(MIN_ID, "Minerval", "Scolarité", 1_000)]);
    render(<QuickPaymentModal open mode="quick-student" initialStudentId={ESTHER_UUID} onClose={() => undefined} />);
    await waitFor(() => expect(screen.getByLabelText(/Frais concerné/i)).toHaveValue(MIN_ID));
    fireEvent.change(screen.getByLabelText(/Montant à encaisser/i), { target: { value: "80" } });
    const save = screen.getByRole("button", { name: "Enregistrer l'encaissement" });
    await userEvent.setup().click(save);
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("réseau", "error"));
    createPayment.mockImplementation(async (payload) => echoPayment(payload));
    await userEvent.setup().click(save);
    await waitFor(() => expect(createPayment).toHaveBeenCalledTimes(2));
    expect(createPayment.mock.calls[0][1].idempotencyKey).toBe(createPayment.mock.calls[1][1].idempotencyKey);
  });

  it("un échec d'enregistrement ne produit ni reçu ni callback", async () => {
    createPayment.mockRejectedValueOnce(new Error("échec item #3"));
    const onSaved = vi.fn();
    listStudentFees.mockResolvedValue([obligation(MIN_ID, "Minerval", "Scolarité", 1_000)]);
    render(
      <QuickPaymentModal
        open
        mode="quick-student"
        initialStudentId={ESTHER_UUID}
        onClose={() => undefined}
        onSaved={onSaved}
      />,
    );
    await waitFor(() => expect(screen.getByLabelText(/Frais concerné/i)).toHaveValue(MIN_ID));
    fireEvent.change(screen.getByLabelText(/Montant à encaisser/i), { target: { value: "100" } });
    await userEvent.setup().click(screen.getByRole("button", { name: "Enregistrer l'encaissement" }));
    await waitFor(() => expect(showToast).toHaveBeenCalledWith("échec item #3", "error"));
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.queryByRole("heading", { name: "Reçu de paiement" })).not.toBeInTheDocument();
    expect(screen.getByTestId("quick-payment-modal")).toBeInTheDocument();
  });
});
