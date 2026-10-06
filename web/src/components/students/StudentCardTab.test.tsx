import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import type { SchoolSettings } from "../../lib/schoolSettingsApi";
import { ApiError } from "../../api/client";

const qrToDataUrl = vi.hoisted(() => vi.fn(async (value?: string, options?: unknown) => {
  void value;
  void options;
  return "data:image/png;base64,qr";
}));
const api = vi.hoisted(() => ({
  getSettings: vi.fn(),
  list: vi.fn(),
  issue: vi.fn(),
  markLost: vi.fn(),
  revoke: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: (value: string, options?: unknown) => qrToDataUrl(value, options) },
}));

vi.mock("../../lib/schoolSettingsApi", () => ({
  schoolSettingsApi: {
    get: (...args: unknown[]) => api.getSettings(...args),
  },
}));

vi.mock("../../lib/studentCardsApi", () => ({
  studentCardsApi: {
    list: (...args: unknown[]) => api.list(...args),
    issue: (...args: unknown[]) => api.issue(...args),
    markLost: (...args: unknown[]) => api.markLost(...args),
    revoke: (...args: unknown[]) => api.revoke(...args),
    replace: (...args: unknown[]) => api.replace(...args),
  },
}));

import { formatDateTimeForDisplay } from "../../lib/dates";
import { StudentCardTab } from "./StudentCardTab";

const workspace = {
  studentId: "stu-1",
  displayName: "Kabila Amina",
  classLabel: "6ème A",
  matriculeLabel: "CD-001",
  schoolNameLabel: "Lycée Test",
} as StudentWorkspaceViewModel;

const dossier = {
  studentCode: "CD-001",
  photoUrl: "",
  parentPhone: "+243800000000",
  parentEmail: "parent@exemple.test",
  birthDate: "2012-01-01",
  id: "student-uuid",
  schoolId: "school-uuid",
};

function flags(partial: Partial<SchoolSettings> = {}): SchoolSettings {
  return {
    schoolCode: "CD-1",
    periodMode: "trimestre",
    defaultScale: 20,
    reportCardMode: "period",
    studentCardEnabled: true,
    studentCardQrEnabled: true,
    studentCardNfcEnabled: false,
    ...partial,
  };
}

describe("StudentCardTab", () => {
  beforeEach(() => {
    api.getSettings.mockReset();
    api.list.mockReset();
    api.issue.mockReset();
    api.markLost.mockReset();
    api.revoke.mockReset();
    api.replace.mockReset();
    qrToDataUrl.mockClear();
    api.getSettings.mockResolvedValue(flags());
    api.list.mockResolvedValue({ cards: [] });
  });

  it("reste fail-closed sans master et n'émet pas", async () => {
    api.getSettings.mockResolvedValue(flags({ studentCardEnabled: false }));
    render(
      <StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />,
    );
    expect(await screen.findByText("Carte élève désactivée pour cet établissement.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Émettre une carte" })).toBeNull();
    expect(api.list).not.toHaveBeenCalled();
    expect(api.issue).not.toHaveBeenCalled();
  });

  it("refuse l'émission NFC seule et autorise qr ou nfc_qr", async () => {
    const user = userEvent.setup();
    api.getSettings.mockResolvedValue(flags({ studentCardQrEnabled: false, studentCardNfcEnabled: true }));
    const { rerender } = render(
      <StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />,
    );
    expect(await screen.findByText(/émission NFC seule/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Émettre une carte" })).toBeNull();

    api.getSettings.mockResolvedValue(flags({ studentCardQrEnabled: true, studentCardNfcEnabled: true }));
    api.issue.mockResolvedValue({
      id: "card-1",
      publicId: "CARD-A",
      cardToken: "CARD-A.TOKEN-1",
      medium: "nfc_qr",
      status: "active",
    });
    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-2" />);
    await user.click(await screen.findByRole("button", { name: "Émettre une carte" }));
    await user.click(screen.getByRole("button", { name: "Émettre" }));
    expect(api.issue).toHaveBeenCalledWith("stu-1", "nfc_qr");
    expect(qrToDataUrl).toHaveBeenCalledWith("CARD-A.TOKEN-1", expect.any(Object));
    expect(document.body.textContent).not.toContain("TOKEN-1");
    expect(document.body.innerHTML).not.toContain("CARD-A.TOKEN-1");
  });

  it("affiche le QR une fois puis l'oublie, sans bouton de réimpression", async () => {
    const user = userEvent.setup();
    api.issue.mockResolvedValue({
      id: "card-1",
      publicId: "CARD-A",
      cardToken: "CARD-A.TOKEN-1",
      medium: "qr",
      status: "active",
    });
    api.list
      .mockResolvedValueOnce({ cards: [] })
      .mockResolvedValue({
        cards: [{ id: "card-1", publicId: "CARD-A", medium: "qr", status: "active", issuedAt: "2026-10-06T00:00:00.000Z" }],
      });
    render(<StudentCardTab workspace={workspace} dossier={dossier as never} canManage schoolCode="CD-1" />);
    await user.click(await screen.findByRole("button", { name: "Émettre une carte" }));
    await user.click(screen.getByRole("button", { name: "Émettre" }));
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(screen.getByText("Kabila Amina")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("TOKEN-1");
    expect(document.body.textContent).not.toContain("+243800000000");
    expect(document.body.textContent).not.toContain("parent@exemple.test");
    await user.click(screen.getByRole("button", { name: "Terminer" }));
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expect(document.body.textContent).not.toContain("TOKEN-1");
    expect(screen.queryByRole("button", { name: /réimprimer/i })).toBeNull();
    expect(await screen.findByText(/n’est disponible qu’au moment de l’émission/i)).toBeInTheDocument();
    expect(screen.getByText(`Émise le ${formatDateTimeForDisplay("2026-10-06T00:00:00.000Z")}`)).toBeInTheDocument();
    expect(screen.getByText(/Émise le \d{2}-\d{2}-\d{4} \d{2}:\d{2}/)).toBeInTheDocument();
  });

  it("n'offre pas une seconde émission lorsqu'une carte active existe", async () => {
    api.list.mockResolvedValue({
      cards: [{ id: "card-1", publicId: "CARD-A", medium: "qr", status: "active" }],
    });
    render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />);
    expect(await screen.findByText("ID carte : CARD-A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Émettre une carte" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Émettre" })).toBeNull();
    expect(api.issue).not.toHaveBeenCalled();
  });

  it("rafraîchit la liste sur 409 sans second essai", async () => {
    const user = userEvent.setup();
    api.issue.mockRejectedValue(new ApiError("déjà émise pour un autre dossier", 409, "STUDENT_CARD_ACTIVE_ALREADY_EXISTS"));
    api.list
      .mockResolvedValueOnce({ cards: [] })
      .mockResolvedValue({
        cards: [{ id: "card-1", publicId: "CARD-A", medium: "qr", status: "active" }],
      });
    render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />);
    await user.click(await screen.findByRole("button", { name: "Émettre une carte" }));
    const listsBeforeConfirm = api.list.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Émettre" }));
    expect(await screen.findByText("Une carte active existe déjà. La liste a été actualisée.")).toBeInTheDocument();
    expect(api.issue).toHaveBeenCalledTimes(1);
    expect(api.list.mock.calls.length).toBeGreaterThan(listsBeforeConfirm);
    expect(screen.getByText("ID carte : CARD-A")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Émettre" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Émettre une carte" })).toBeNull();
    expect(document.body.textContent).not.toContain("autre dossier");
  });

  it("remplace une carte active et n'offre plus l'ancien secret", async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue({
      cards: [{ id: "card-1", publicId: "CARD-A", medium: "qr", status: "active", issuedAt: "2026-10-01T00:00:00.000Z" }],
    });
    api.replace.mockResolvedValue({
      previous: { id: "card-1", publicId: "CARD-A", medium: "qr", status: "replaced" },
      card: { id: "card-2", publicId: "CARD-B", cardToken: "CARD-B.TOKEN-2", medium: "qr", status: "active" },
    });
    render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />);
    await user.click(await screen.findByRole("button", { name: "Remplacer" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remplacer" }));
    expect(api.replace).toHaveBeenCalledWith("card-1");
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    expect(qrToDataUrl).toHaveBeenCalledWith("CARD-B.TOKEN-2", expect.any(Object));
    expect(document.body.textContent).not.toContain("TOKEN-2");
    await user.click(screen.getByRole("button", { name: "Terminer" }));
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expect(document.body.textContent).not.toContain("TOKEN-2");
  });

  it("masque les mutations sans Élèves UPDATE et les limite au statut", async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue({
      cards: [
        { id: "card-1", publicId: "CARD-A", medium: "nfc", status: "active" },
        { id: "card-2", publicId: "CARD-B", medium: "qr", status: "lost" },
        { id: "card-3", publicId: "CARD-C", medium: "qr", status: "revoked", revokeReason: "sortie" },
        { id: "card-4", publicId: "CARD-D", medium: "qr", status: "replaced" },
      ],
    });
    const { rerender } = render(
      <StudentCardTab workspace={workspace} canManage={false} schoolCode="CD-1" />,
    );
    expect(await screen.findByText("ID carte : CARD-A")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Déclarer perdue" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Révoquer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remplacer" })).toBeNull();
    expect(screen.getByText("NFC")).toBeInTheDocument();

    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-1" />);
    const active = await screen.findByRole("article", { name: "Carte CARD-A" });
    expect(within(active).getByRole("button", { name: "Déclarer perdue" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Révoquer" })).toBeInTheDocument();
    expect(within(active).getByRole("button", { name: "Remplacer" })).toBeInTheDocument();
    const lost = screen.getByRole("article", { name: "Carte CARD-B" });
    expect(within(lost).getByRole("button", { name: "Remplacer" })).toBeInTheDocument();
    expect(within(lost).queryByRole("button", { name: "Révoquer" })).toBeNull();
    expect(within(screen.getByRole("article", { name: "Carte CARD-C" })).queryByRole("button")).toBeNull();
    expect(within(screen.getByRole("article", { name: "Carte CARD-D" })).queryByRole("button")).toBeNull();
    expect(screen.getByText("Motif : sortie")).toBeInTheDocument();

    api.markLost.mockResolvedValue({});
    await user.click(within(active).getByRole("button", { name: "Déclarer perdue" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Déclarer perdue" }));
    expect(api.markLost).toHaveBeenCalledWith("card-1");
  });

  it("efface le QR dès que l'établissement change", async () => {
    const user = userEvent.setup();
    api.issue.mockResolvedValue({
      id: "card-a",
      publicId: "CARD-A",
      cardToken: "CARD-A.TOKEN-A",
      medium: "qr",
      status: "active",
    });
    const { rerender } = render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-A" />);
    await user.click(await screen.findByRole("button", { name: "Émettre une carte" }));
    await user.click(screen.getByRole("button", { name: "Émettre" }));
    expect(await screen.findByTestId("student-card-qr")).toBeInTheDocument();
    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-B" />);
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expect(document.body.textContent).not.toContain("TOKEN-A");
    expect(document.body.innerHTML).not.toContain("CARD-A.TOKEN-A");
  });

  it("ignore une émission de l'établissement A résolue après le passage à B", async () => {
    const user = userEvent.setup();
    let resolveIssue: (value: unknown) => void = () => undefined;
    api.issue.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveIssue = resolve;
        }),
    );
    const { rerender } = render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-A" />);
    await user.click(await screen.findByRole("button", { name: "Émettre une carte" }));
    await user.click(screen.getByRole("button", { name: "Émettre" }));
    await waitFor(() => expect(api.issue).toHaveBeenCalledTimes(1));
    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-B" />);
    expect(await screen.findByText("Aucune carte élève active.")).toBeInTheDocument();
    await act(async () => {
      resolveIssue({
        id: "card-a",
        publicId: "CARD-A",
        cardToken: "CARD-A.TOKEN-A",
        medium: "qr",
        status: "active",
      });
    });
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expect(screen.queryByText("ID carte : CARD-A")).toBeNull();
    expect(document.body.textContent).not.toContain("TOKEN-A");
    expect(document.body.innerHTML).not.toContain("CARD-A.TOKEN-A");
    expect(screen.getByText("Aucune carte élève active.")).toBeInTheDocument();
  });

  it("conserve uniquement les cartes de l'établissement B si la réponse A arrive après", async () => {
    const pendingLists: Array<(value: { cards: Array<Record<string, string>> }) => void> = [];
    api.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          pendingLists.push(resolve);
        }),
    );
    const { rerender } = render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-A" />);
    await waitFor(() => expect(pendingLists.length).toBeGreaterThan(0));
    const schoolAResolvers = pendingLists.slice();
    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-B" />);
    await waitFor(() => expect(pendingLists.length).toBeGreaterThan(schoolAResolvers.length));
    const schoolBResolvers = pendingLists.slice(schoolAResolvers.length);
    await act(async () => {
      for (const resolve of schoolBResolvers) {
        resolve({ cards: [{ id: "card-b", publicId: "CARD-B", medium: "qr", status: "active" }] });
      }
    });
    expect(await screen.findByText("ID carte : CARD-B")).toBeInTheDocument();
    await act(async () => {
      for (const resolve of schoolAResolvers) {
        resolve({ cards: [{ id: "card-a", publicId: "CARD-A", medium: "qr", status: "active" }] });
      }
    });
    expect(screen.queryByText("ID carte : CARD-A")).toBeNull();
    expect(screen.getByText("ID carte : CARD-B")).toBeInTheDocument();
  });

  it("ignore un remplacement de l'établissement A résolu après le passage à B", async () => {
    const user = userEvent.setup();
    api.list.mockResolvedValue({
      cards: [{ id: "card-1", publicId: "CARD-A", medium: "qr", status: "active" }],
    });
    let resolveReplace: (value: unknown) => void = () => undefined;
    api.replace.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReplace = resolve;
        }),
    );
    const { rerender } = render(<StudentCardTab workspace={workspace} canManage schoolCode="CD-A" />);
    await user.click(await screen.findByRole("button", { name: "Remplacer" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remplacer" }));
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith("card-1"));
    api.list.mockResolvedValue({
      cards: [{ id: "card-b", publicId: "CARD-B", medium: "qr", status: "active" }],
    });
    rerender(<StudentCardTab workspace={workspace} canManage schoolCode="CD-B" />);
    expect(await screen.findByText("ID carte : CARD-B")).toBeInTheDocument();
    await act(async () => {
      resolveReplace({
        previous: { id: "card-1", publicId: "CARD-A", medium: "qr", status: "replaced" },
        card: {
          id: "card-2",
          publicId: "CARD-A2",
          cardToken: "CARD-A2.TOKEN-A2",
          medium: "qr",
          status: "active",
        },
      });
    });
    expect(screen.queryByTestId("student-card-qr")).toBeNull();
    expect(screen.queryByText("ID carte : CARD-A2")).toBeNull();
    expect(screen.getByText("ID carte : CARD-B")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("TOKEN-A2");
    expect(document.body.innerHTML).not.toContain("CARD-A2.TOKEN-A2");
  });
});
