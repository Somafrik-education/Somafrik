/**
 * DEEPLINK-JOURNEY — parcours complet d'une notification.
 *
 * Les tests R1 s'arrêtaient à `navigate("/page?id=123")`. Ici on monte le
 * centre de notifications ET la page de destination dans le même Router : on
 * clique réellement sur « Ouvrir » et on vérifie que la ressource visée est
 * ouverte à l'arrivée, pas seulement que l'URL est correcte.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { InternalNotificationsCenter } from "../components/communications/InternalNotificationsCenter";
import { MessagesConversationsPage } from "./MessagesConversationsPage";
import { PlanningSubstitutionsPage } from "./planning/PlanningSubstitutionsPage";

const showToast = vi.hoisted(() => vi.fn());
const notificationsList = vi.hoisted(() => vi.fn());
const notificationsUnread = vi.hoisted(() => vi.fn());
const notificationsMarkRead = vi.hoisted(() => vi.fn());
const listConversations = vi.hoisted(() => vi.fn());
const listMessages = vi.hoisted(() => vi.fn());
const listRecipients = vi.hoisted(() => vi.fn());
const messagesMarkRead = vi.hoisted(() => vi.fn());
const replacementsList = vi.hoisted(() => vi.fn());
const replacementsOptions = vi.hoisted(() => vi.fn());
const listOccurrences = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" } } }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({
    activeSchoolCode: "SCH-001",
    requiresSelection: false,
    scopedUser: { id: "user-1", role: "Admin School", schoolCode: "SCH-001" },
  }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canRead: true, canCreate: true, canUpdate: true, canDelete: true }),
  usePermissionContext: () => ({}),
}));

vi.mock("../components/ui/Toast", () => ({
  useToast: () => ({ showToast }),
}));

vi.mock("../lib/internalNotificationsRead", () => ({
  notifyInternalNotificationsChanged: vi.fn(),
}));

vi.mock("../lib/internalNotificationsApi", () => ({
  internalNotificationsApi: {
    list: notificationsList,
    unreadCount: notificationsUnread,
    markRead: notificationsMarkRead,
    archive: vi.fn(),
    create: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock("../lib/messagesApi", () => ({
  messagesApi: {
    listConversations,
    listMessages,
    listRecipients,
    markRead: messagesMarkRead,
    send: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock("../lib/planningRoomsReplacementsApi", () => ({
  replacementsApi: {
    list: replacementsList,
    options: replacementsOptions,
    create: vi.fn(),
    cancel: vi.fn(),
  },
  schoolRoomsApi: { list: vi.fn() },
}));

vi.mock("../lib/pedagogyApi", () => ({
  pedagogyApi: { listCourseScheduleOccurrences: listOccurrences },
}));

function notification(navigationTarget: Record<string, unknown>) {
  return {
    id: "notif-1",
    title: "Notification",
    body: "Corps",
    eventType: "communication.message.received",
    senderName: "Somafrik",
    createdAt: "2026-09-09T08:00:00.000Z",
    publishedAt: "2026-09-09T08:00:00.000Z",
    readAt: "2026-09-09T09:00:00.000Z",
    attachments: [],
    navigationTarget,
  };
}

function renderJourney() {
  return render(
    <MemoryRouter initialEntries={["/notifications"]}>
      <Routes>
        <Route path="/notifications" element={<InternalNotificationsCenter />} />
        <Route path="/messages" element={<MessagesConversationsPage />} />
        <Route path="/planning/remplacements" element={<PlanningSubstitutionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  notificationsUnread.mockResolvedValue({ count: 0 });
  notificationsMarkRead.mockImplementation(async () => {
    throw new Error("markRead ne doit pas être appelé sur une notification déjà lue");
  });
  listRecipients.mockResolvedValue({ items: [] });
  listOccurrences.mockResolvedValue({ items: [] });
  replacementsOptions.mockResolvedValue({ originalTeacherName: "", items: [] });
});

describe("DEEPLINK-JOURNEY — notification → Ouvrir → page destination → ressource ouverte", () => {
  it("DEEPLINK-JOURNEY-01 — conversation : la conversation visée est sélectionnée et son fil chargé", async () => {
    notificationsList.mockResolvedValue({
      items: [notification({ type: "conversation", conversationId: "conv-2" })],
      nextCursor: null,
    });
    listConversations.mockResolvedValue({
      items: [
        { id: "conv-1", subject: "Autre fil", participants: [], unreadCount: 0, updatedAt: "2026-09-08T08:00:00.000Z" },
        { id: "conv-2", subject: "Fil visé", participants: [], unreadCount: 1, updatedAt: "2026-09-09T08:00:00.000Z" },
      ],
    });
    listMessages.mockResolvedValue({
      items: [
        {
          id: "msg-1",
          conversationId: "conv-2",
          senderUserId: "user-2",
          senderName: "Parent",
          body: "Message du fil visé",
          sentAt: "2026-09-09T08:05:00.000Z",
          readAt: null,
        },
      ],
    });

    renderJourney();
    await screen.findByText("Notification");
    await userEvent.click(screen.getByRole("button", { name: /Afficher les détails/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir" }));

    await waitFor(() => expect(listMessages).toHaveBeenCalledWith("conv-2", "", "SCH-001"));
    const thread = await screen.findByTestId("messages-thread");
    expect(thread).toHaveAttribute("data-conversation-id", "conv-2");
    expect(await screen.findByText("Message du fil visé")).toBeInTheDocument();

    const items = screen.getAllByTestId("messages-conversation-item");
    const targeted = items.find((node) => node.getAttribute("data-conversation-id") === "conv-2");
    expect(targeted).toHaveAttribute("aria-selected", "true");
    const other = items.find((node) => node.getAttribute("data-conversation-id") === "conv-1");
    expect(other).toHaveAttribute("aria-selected", "false");
  });

  it("DEEPLINK-JOURNEY-01b — sans conversationId, aucun fil n'est ouvert d'office", async () => {
    listConversations.mockResolvedValue({
      items: [{ id: "conv-1", subject: "Autre fil", participants: [], unreadCount: 0, updatedAt: "2026-09-08T08:00:00.000Z" }],
    });
    render(
      <MemoryRouter initialEntries={["/messages"]}>
        <Routes>
          <Route path="/messages" element={<MessagesConversationsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findAllByTestId("messages-conversation-item");
    expect(listMessages).not.toHaveBeenCalled();
    expect(screen.getByTestId("messages-thread")).not.toHaveAttribute("data-conversation-id");
  });

  it("DEEPLINK-JOURNEY-02 — remplacement : le remplacement existant est sélectionné, le wizard de création reste fermé", async () => {
    notificationsList.mockResolvedValue({
      items: [
        notification({
          type: "teacher_replacement",
          replacementId: "rep-9",
          weeklySlotId: "slot-1",
          occurrenceDate: "2026-09-10",
          classId: "class-1",
        }),
      ],
      nextCursor: null,
    });
    replacementsList.mockResolvedValue({
      items: [
        {
          id: "rep-8",
          weeklySlotId: "slot-2",
          occurrenceDate: "2026-09-10",
          originalTeacherId: "t-1",
          originalTeacherName: "Autre titulaire",
          substituteTeacherId: "t-2",
          substituteTeacherName: "Autre remplaçant",
          className: "5e B",
          courseName: "Histoire",
          startTime: "10:00",
          endTime: "11:00",
          room: "B2",
          reason: "Congé",
          status: "planned",
        },
        {
          id: "rep-9",
          weeklySlotId: "slot-1",
          occurrenceDate: "2026-09-10",
          originalTeacherId: "t-3",
          originalTeacherName: "Mme Kabila",
          substituteTeacherId: "t-4",
          substituteTeacherName: "M. Ilunga",
          className: "6e A",
          courseName: "Mathématiques",
          startTime: "08:00",
          endTime: "09:00",
          room: "A1",
          reason: "Mission",
          status: "planned",
        },
      ],
    });

    renderJourney();
    await screen.findByText("Notification");
    await userEvent.click(screen.getByRole("button", { name: /Afficher les détails/ }));
    await userEvent.click(await screen.findByRole("button", { name: "Ouvrir" }));

    const selected = await screen.findByTestId("planning-replacement-selected");
    expect(selected).toHaveAttribute("data-replacement-id", "rep-9");
    expect(selected).toHaveTextContent("Mme Kabila");
    expect(selected).toHaveTextContent("M. Ilunga");

    // Le wizard « Programmer un remplacement » ne doit pas s'ouvrir.
    expect(screen.queryByTestId("planning-replacement-save")).toBeNull();
    expect(screen.queryByTestId("planning-replacement-slot")).toBeNull();
    expect(screen.queryByText("Programmer un remplacement")).toBeNull();

    const rows = screen.getAllByRole("row").filter((row) => row.getAttribute("data-selected") === "true");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("Mme Kabila");
  });

  it("DEEPLINK-JOURNEY-03 — sans replacementId, le wizard de création reste disponible", async () => {
    replacementsList.mockResolvedValue({ items: [] });
    listOccurrences.mockResolvedValue({
      items: [
        {
          scheduleId: "slot-1",
          occurrenceDate: "2026-09-10",
          className: "6e A",
          courseName: "Mathématiques",
          startTime: "08:00",
          endTime: "09:00",
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/planning/remplacements?weeklySlotId=slot-1&occurrenceDate=2026-09-10"]}>
        <Routes>
          <Route path="/planning/remplacements" element={<PlanningSubstitutionsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByTestId("planning-replacement-save")).toBeInTheDocument();
    expect(await screen.findByTestId("planning-replacement-slot")).toHaveValue("slot-1");
    expect(screen.queryByTestId("planning-replacement-selected")).toBeNull();
  });
});
