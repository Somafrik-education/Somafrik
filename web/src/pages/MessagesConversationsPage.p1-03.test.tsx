/**
 * P1-03 — changement d'établissement Web Messages : pas de fuite A → B.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MessagesConversationsPage } from "./MessagesConversationsPage";

const showToast = vi.hoisted(() => vi.fn());
const listConversations = vi.hoisted(() => vi.fn());
const listMessages = vi.hoisted(() => vi.fn());
const listRecipients = vi.hoisted(() => vi.fn());
const schoolState = vi.hoisted(() => ({
  activeSchoolCode: "SCH-A",
  requiresSelection: true,
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-A", roleKeys: ["SCHOOL_ADMIN"] } },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    get activeSchoolCode() {
      return schoolState.activeSchoolCode;
    },
    get requiresSelection() {
      return schoolState.requiresSelection;
    },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({
    canRead: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  }),
  usePermissionContext: () => ({}),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../lib/messagesRead", () => ({
  notifyMessagesUnreadChanged: () => undefined,
  useMessagesUnreadCount: () => 0,
  MESSAGES_UNREAD_CHANGED_EVENT: "somafrik:messages-unread-changed",
}));

vi.mock("../lib/messagesApi", () => ({
  messagesApi: {
    listConversations,
    listMessages,
    listRecipients,
    markRead: vi.fn(),
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    send: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

function conversation(id: string, subject: string) {
  return {
    id,
    subject,
    participants: [{ userId: "other", name: subject }],
    unreadCount: 0,
    updatedAt: "2026-09-09T08:00:00.000Z",
  };
}

function recipient(userId: string, name: string) {
  return { userId, displayName: name, roleLabel: "Parent", kind: "parent" };
}

describe("P1-03 Web Messages school switch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    schoolState.activeSchoolCode = "SCH-A";
    schoolState.requiresSelection = true;
    listMessages.mockResolvedValue({ items: [] });
  });

  it("changement A → B supprime les données A avant d'afficher B", async () => {
    listConversations
      .mockResolvedValueOnce({ items: [conversation("conv-a", "Fil A")], nextCursor: null })
      .mockResolvedValueOnce({ items: [conversation("conv-b", "Fil B")], nextCursor: null });
    listRecipients
      .mockResolvedValueOnce({ items: [recipient("recv-a", "Dest A")] })
      .mockResolvedValueOnce({ items: [recipient("recv-b", "Dest B")] });

    const view = render(
      <MemoryRouter>
        <MessagesConversationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("Fil A")).toBeInTheDocument());
    expect(screen.getByText(/Dest A/)).toBeInTheDocument();

    schoolState.activeSchoolCode = "SCH-B";
    view.rerender(
      <MemoryRouter>
        <MessagesConversationsPage />
      </MemoryRouter>,
    );

    expect(screen.queryByText("Fil A")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dest A/)).not.toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("Fil B")).toBeInTheDocument());
    expect(screen.getByText(/Dest B/)).toBeInTheDocument();
    expect(screen.queryByText("Fil A")).not.toBeInTheDocument();
    expect(screen.queryByText(/Dest A/)).not.toBeInTheDocument();
  });

  it("réponse tardive A après sélection B est ignorée", async () => {
    let resolveA: ((value: { items: ReturnType<typeof conversation>[]; nextCursor: null }) => void) | undefined;
    listConversations.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveA = resolve;
        }),
    );
    listConversations.mockResolvedValueOnce({ items: [conversation("conv-b", "Fil B")], nextCursor: null });
    listRecipients.mockResolvedValue({ items: [] });

    const view = render(
      <MemoryRouter>
        <MessagesConversationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(1));

    schoolState.activeSchoolCode = "SCH-B";
    view.rerender(
      <MemoryRouter>
        <MessagesConversationsPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(listConversations).toHaveBeenCalledTimes(2));
    resolveA?.({ items: [conversation("conv-a", "Fil A")], nextCursor: null });

    await waitFor(() => expect(screen.getByText("Fil B")).toBeInTheDocument());
    expect(screen.queryByText("Fil A")).not.toBeInTheDocument();
  });
});
