/**
 * Lot R3 (RED) — compteur de non lues et pagination de l'inbox C4.
 *
 * Scénario figé, identique au harnais backend `communicationsUnreadPagination.red.test.js` :
 * 51 notifications, les 50 plus récentes lues, la plus ancienne non lue.
 *
 * Contrat visé : la page doit afficher le même nombre de non lues que le badge
 * de la Topbar, et la 51ᵉ notification doit rester atteignable depuis l'interface.
 *
 * État actuel (develop@7bcca23a) : la page ne charge que la première page,
 * ignore le `nextCursor` pourtant renvoyé par l'API, et calcule son compteur
 * localement sur ce qu'elle a reçu. Elle affiche donc « 0 non lue(s) » pendant
 * que le badge affiche 1. Ces tests échouent aujourd'hui, par conception.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const { navigateSpy, listSpy, markReadSpy, archiveSpy, notifySpy, unreadCountSpy } = vi.hoisted(() => ({
  navigateSpy: vi.fn(),
  listSpy: vi.fn(),
  markReadSpy: vi.fn(),
  archiveSpy: vi.fn(),
  notifySpy: vi.fn(),
  unreadCountSpy: vi.fn(),
}));

vi.mock("react-router-dom", () => ({ useNavigate: () => navigateSpy }));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "SCH-001" }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canCreate: false }),
}));

vi.mock("../../lib/internalNotificationsApi", () => ({
  internalNotificationsApi: {
    list: (...args: unknown[]) => listSpy(...args),
    markRead: (...args: unknown[]) => markReadSpy(...args),
    archive: (...args: unknown[]) => archiveSpy(...args),
    unreadCount: (...args: unknown[]) => unreadCountSpy(...args),
    downloadAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/internalNotificationsRead", () => ({
  notifyInternalNotificationsChanged: () => notifySpy(),
  useInternalNotificationsUnreadCount: () => 1,
  INTERNAL_NOTIFICATIONS_CHANGED_EVENT: "somafrik:internal-notifications-changed",
}));

vi.mock("../ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import { InternalNotificationsCenter } from "./InternalNotificationsCenter";

const TOTAL = 51;
const OLDEST_TITLE = "Notification la plus ancienne";
const NEXT_CURSOR = "2026-09-09T10:00:00.000Z|00000000-0000-4000-8000-000000000050";

function record(index: number, readAt: string) {
  return {
    type: "notification" as const,
    id: `note-${index}`,
    schoolCode: "SCH-001",
    eventType: "communication.message.created",
    sourceEntityType: "message",
    sourceEntityId: `src-${index}`,
    senderType: "system" as const,
    senderUserId: null,
    senderName: "Somafrik",
    title: index === 0 ? OLDEST_TITLE : `Notification ${index}`,
    body: "corps",
    createdAt: "2026-09-09T07:00:00.000Z",
    publishedAt: "2026-09-09T07:00:00.000Z",
    readAt,
    archivedAt: "",
    status: readAt ? "Lu" : "Non lu",
    attachments: [],
    navigationTarget: { type: "conversation", conversationId: `conv-${index}` },
    metadataSafe: {},
  };
}

/** Page 1 : les 50 plus récentes, toutes lues. Page 2 : l'unique non lue. */
const FIRST_PAGE = Array.from({ length: TOTAL - 1 }, (_, i) => record(TOTAL - 1 - i, "2026-09-09T08:00:00.000Z"));
const SECOND_PAGE = [record(0, "")];

function mockPaginatedList() {
  listSpy.mockImplementation((...args: unknown[]) => {
    const usesCursor = args.some((arg) => {
      if (typeof arg === "string") return arg.includes("|");
      if (arg && typeof arg === "object") return Boolean((arg as { cursor?: string }).cursor);
      return false;
    });
    return Promise.resolve(
      usesCursor
        ? { items: SECOND_PAGE, nextCursor: null }
        : { items: FIRST_PAGE, nextCursor: NEXT_CURSOR },
    );
  });
}

/** Déclenche une éventuelle commande « charger plus » si l'interface en expose une. */
async function tryLoadMore() {
  const more = screen.queryAllByRole("button", { name: /plus|suivant|charger|afficher/i });
  for (const button of more) {
    await userEvent.click(button);
  }
  return more.length > 0;
}

describe("RED-N2 — compteur de non lues et atteignabilité au-delà de la première page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    unreadCountSpy.mockResolvedValue({ count: 1 });
    markReadSpy.mockImplementation(async () => record(0, "2026-09-09T11:00:00.000Z"));
    archiveSpy.mockResolvedValue({ id: "note-0", archivedAt: "2026-09-09T11:00:00.000Z" });
    mockPaginatedList();
  });

  it("RED-N2-01 — la page annonce le même nombre de non lues que le badge", async () => {
    render(<InternalNotificationsCenter />);
    await screen.findByText(/Notification 50/);

    await waitFor(() => {
      expect(
        screen.queryByText(/1 non lue\(s\)/),
        "la page doit afficher « 1 non lue(s) » comme le badge, et non un compte limité à la première page",
      ).not.toBeNull();
    });
  });

  it("RED-N2-02 — la page n'affiche jamais un compteur contredisant le badge", async () => {
    render(<InternalNotificationsCenter />);
    await screen.findByText(/Notification 50/);
    await tryLoadMore();

    expect(
      screen.queryByText(/0 non lue\(s\)/),
      "« 0 non lue(s) » alors que le badge vaut 1 : c'est exactement l'incohérence constatée en préproduction",
    ).toBeNull();
  });

  it("RED-N2-03 — la 51ᵉ notification reste atteignable depuis l'interface", async () => {
    render(<InternalNotificationsCenter />);
    await screen.findByText(/Notification 50/);
    await tryLoadMore();

    await waitFor(() => {
      expect(
        screen.queryByText(OLDEST_TITLE),
        "la notification non lue au-delà de la première page doit pouvoir être atteinte",
      ).not.toBeNull();
    });
  });

  it("RED-N2-04 — le nextCursor renvoyé par l'API est réellement consommé", async () => {
    render(<InternalNotificationsCenter />);
    await screen.findByText(/Notification 50/);
    await tryLoadMore();

    const usedCursor = listSpy.mock.calls.some((call) =>
      call.some((arg) => {
        if (typeof arg === "string") return arg === NEXT_CURSOR;
        if (arg && typeof arg === "object") return (arg as { cursor?: string }).cursor === NEXT_CURSOR;
        return false;
      }),
    );
    expect(
      usedCursor,
      `nextCursor jamais renvoyé à l'API : appels observés ${JSON.stringify(listSpy.mock.calls)}`,
    ).toBe(true);
  });

  it("RED-N2-05 — sans page suivante, compteur page et badge restent alignés", async () => {
    listSpy.mockResolvedValue({ items: [record(0, "")], nextCursor: null });
    render(<InternalNotificationsCenter />);
    await screen.findByText(OLDEST_TITLE);

    await waitFor(() => {
      expect(
        screen.queryByText(/1 non lue\(s\)/),
        "cas de contrôle : sous le seuil de pagination, les deux compteurs doivent déjà coïncider",
      ).not.toBeNull();
    });
  });
});
