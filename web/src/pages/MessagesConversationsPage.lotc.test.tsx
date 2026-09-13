/**
 * Lot C — RED-04 / RED-05 Web Messages.
 * Badge unread après lecture + pagination nextCursor sans doublon ni perte de scope.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MemoryRouter } from "react-router-dom";
import { MessagesConversationsPage } from "./MessagesConversationsPage";

const showToast = vi.hoisted(() => vi.fn());
const notifyUnread = vi.hoisted(() => vi.fn());
const listConversations = vi.hoisted(() => vi.fn());
const listMessages = vi.hoisted(() => vi.fn());
const listRecipients = vi.hoisted(() => vi.fn());
const messagesMarkRead = vi.hoisted(() => vi.fn());
const permissions = vi.hoisted(() => ({
  canRead: true,
  canCreate: true,
  canUpdate: true,
  canDelete: true,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } } }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    requiresSelection: false,
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({
    canRead: permissions.canRead,
    canCreate: permissions.canCreate,
    canUpdate: permissions.canUpdate,
    canDelete: permissions.canDelete,
  }),
  usePermissionContext: () => ({}),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../lib/messagesRead", () => ({
  notifyMessagesUnreadChanged: () => notifyUnread(),
  useMessagesUnreadCount: () => 0,
  MESSAGES_UNREAD_CHANGED_EVENT: "somafrik:messages-unread-changed",
}));

vi.mock("../lib/messagesApi", () => ({
  messagesApi: {
    listConversations,
    listMessages,
    listRecipients,
    markRead: messagesMarkRead,
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    send: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

const NEXT_CURSOR = "2026-09-09T10:00:00.000Z|00000000-0000-4000-8000-000000000050";

function conversation(id: string, unreadCount: number, subject = `Fil ${id}`) {
  return {
    id,
    subject,
    participants: [{ userId: "user-2", name: subject }],
    unreadCount,
    updatedAt: "2026-09-09T08:00:00.000Z",
    lastMessage: { id: `msg-${id}`, body: "extrait", sentAt: "2026-09-09T08:00:00.000Z", senderName: subject },
  };
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/messages"]}>
      <MessagesConversationsPage />
    </MemoryRouter>,
  );
}

function PermissionFlushApp() {
  const [nonce, setNonce] = useState(0);
  return (
    <MemoryRouter initialEntries={["/messages"]}>
      <button type="button" data-testid="lotc-flush-permissions" onClick={() => setNonce((value) => value + 1)}>
        flush {nonce}
      </button>
      <MessagesConversationsPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  permissions.canRead = true;
  permissions.canCreate = true;
  permissions.canUpdate = true;
  permissions.canDelete = true;
  listRecipients.mockResolvedValue({ items: [] });
  messagesMarkRead.mockResolvedValue({});
});

describe("Lot C — Messages Web unread + pagination", () => {
  it("RED-04 — ouvrir un fil recharge la liste : le badge unread disparaît", async () => {
    listConversations
      .mockResolvedValueOnce({ items: [conversation("conv-1", 2, "Parent A")], nextCursor: null })
      .mockResolvedValueOnce({ items: [conversation("conv-1", 0, "Parent A")], nextCursor: null });
    listMessages.mockResolvedValue({
      items: [
        {
          id: "msg-unread",
          conversationId: "conv-1",
          senderUserId: "user-2",
          senderName: "Parent A",
          body: "Bonjour",
          sentAt: "2026-09-09T08:05:00.000Z",
          readAt: null,
        },
      ],
    });

    renderPage();
    const item = await screen.findByTestId("messages-conversation-item");
    expect(screen.getByTestId("messages-unread-badge")).toHaveTextContent("2");

    await userEvent.click(item);
    await waitFor(() => expect(messagesMarkRead).toHaveBeenCalledWith("msg-unread", "SCH-001"));
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(notifyUnread).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByTestId("messages-unread-badge")).toBeNull();
    });
  });

  it("RED-04 — après passage lecture refusée → autorisée, mark-read recharge encore la liste", async () => {
    permissions.canRead = false;
    listConversations
      .mockResolvedValueOnce({ items: [conversation("conv-1", 2, "Parent A")], nextCursor: null })
      .mockResolvedValueOnce({ items: [conversation("conv-1", 0, "Parent A")], nextCursor: null });
    listMessages.mockResolvedValue({
      items: [
        {
          id: "msg-unread",
          conversationId: "conv-1",
          senderUserId: "user-2",
          senderName: "Parent A",
          body: "Bonjour",
          sentAt: "2026-09-09T08:05:00.000Z",
          readAt: null,
        },
      ],
    });

    render(<PermissionFlushApp />);
    expect(listConversations).not.toHaveBeenCalled();

    permissions.canRead = true;
    await userEvent.click(screen.getByTestId("lotc-flush-permissions"));

    const item = await screen.findByTestId("messages-conversation-item");
    await userEvent.click(item);
    await waitFor(() => expect(messagesMarkRead).toHaveBeenCalledWith("msg-unread", "SCH-001"));
    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(notifyUnread).toHaveBeenCalled());
    await waitFor(() => {
      expect(screen.queryByTestId("messages-unread-badge")).toBeNull();
    });
  });

  it("RED-04 — loadThread dépend de loadConversations, sans exemption exhaustive-deps", () => {
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "MessagesConversationsPage.tsx"), "utf8");
    const loadThread = page.slice(page.indexOf("const loadThread = useCallback"), page.indexOf("const loadThread = useCallback") + 1200);
    expect(loadThread).toMatch(/loadConversations\(\{\s*silent:\s*true\s*\}\)/);
    expect(loadThread).toMatch(/\}, \[canUpdate, schoolScope, selfId, loadConversations\]\);/);
    expect(loadThread).not.toMatch(/eslint-disable-next-line react-hooks\/exhaustive-deps/);
  });

  it("RED-05 — nextCursor est consommé, sans doublon, avec le même établissement", async () => {
    const firstPage = Array.from({ length: 50 }, (_, index) =>
      conversation(`conv-${index + 1}`, 0, `Conversation ${index + 1}`),
    );
    const secondPage = [
      conversation("conv-1", 0, "Conversation 1"),
      conversation("conv-51", 1, "Conversation ancienne"),
    ];
    listConversations.mockImplementation((query: string, schoolCode?: string) => {
      expect(schoolCode).toBe("SCH-001");
      if (String(query).includes(encodeURIComponent(NEXT_CURSOR)) || String(query).includes(NEXT_CURSOR)) {
        return Promise.resolve({ items: secondPage, nextCursor: null });
      }
      return Promise.resolve({ items: firstPage, nextCursor: NEXT_CURSOR });
    });
    listMessages.mockResolvedValue({ items: [] });

    renderPage();
    await screen.findByText("Conversation 1");
    expect(screen.queryByText("Conversation ancienne")).toBeNull();

    await userEvent.click(await screen.findByTestId("messages-load-more"));
    await screen.findByText("Conversation ancienne");

    const ids = screen.getAllByTestId("messages-conversation-item").map((node) => node.getAttribute("data-conversation-id"));
    expect(ids.filter((id) => id === "conv-1")).toHaveLength(1);
    expect(ids).toContain("conv-51");
    expect(ids).toHaveLength(51);

    const cursorCalls = listConversations.mock.calls.filter((call) => String(call[0] ?? "").includes("cursor="));
    expect(cursorCalls.length).toBeGreaterThan(0);
    expect(cursorCalls.every((call) => call[1] === "SCH-001")).toBe(true);
  });

  it("RED-05 — sans page suivante, le bouton de chargement est absent", async () => {
    listConversations.mockResolvedValue({ items: [conversation("conv-1", 0)], nextCursor: null });
    renderPage();
    await screen.findByTestId("messages-conversation-item");
    expect(screen.queryByTestId("messages-load-more")).toBeNull();
  });
});
