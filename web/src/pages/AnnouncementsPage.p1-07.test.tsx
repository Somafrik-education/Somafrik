import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const schoolList = vi.hoisted(() => vi.fn());
const platformList = vi.hoisted(() => vi.fn());

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({
    session: {
      user: {
        id: "super-1",
        role: "Super Administrateur Somafrik",
        permissions: ["ALL_PRIVILEGES"],
        schoolCode: "*",
      },
    },
  }),
}));

vi.mock("../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "CD-2026-0001", requiresSelection: true }),
}));

vi.mock("../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canRead: true, canCreate: true, canUpdate: true }),
  usePermissionContext: () => ({}),
}));

vi.mock("../components/ui/Toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("../components/ui/ConfirmDialog", () => ({ useConfirm: () => ({ confirm: vi.fn() }) }));

vi.mock("../lib/announcementsRead", () => ({
  notifyAnnouncementsUnreadChanged: () => undefined,
  useAnnouncementsUnreadCount: () => 0,
  ANNOUNCEMENTS_UNREAD_CHANGED_EVENT: "somafrik:announcements-unread-changed",
}));

vi.mock("../lib/announcementsApi", () => ({
  announcementsApi: {
    list: schoolList,
    get: vi.fn(),
    markRead: vi.fn(),
    unreadCount: vi.fn(),
    audienceOptions: vi.fn(),
    create: vi.fn(),
    archive: vi.fn(),
    uploadAttachment: vi.fn(),
    downloadAttachment: vi.fn(),
  },
}));

vi.mock("../lib/platformAnnouncementsApi", () => ({
  platformAnnouncementsApi: {
    list: platformList,
    get: vi.fn(),
    markRead: vi.fn(),
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn(),
    publish: vi.fn(),
    uploadAttachment: vi.fn(),
  },
}));

import { AnnouncementsPage } from "./AnnouncementsPage";

describe("P1-07 AnnouncementsPage — Superadmin hors annonces scolaires", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    platformList.mockResolvedValue({
      items: [
        {
          id: "plat-1",
          title: "Annonce plateforme",
          message: "Info",
          type: "platform-announcement",
          createdAt: "2026-09-09T08:00:00.000Z",
          publishedAt: "2026-09-09T08:00:00.000Z",
          readAt: "2026-09-09T09:00:00.000Z",
          attachments: [],
        },
      ],
      nextCursor: null,
    });
    schoolList.mockResolvedValue({
      items: [{ id: "sch-1", title: "Annonce scolaire", message: "Secret", attachments: [] }],
      nextCursor: null,
    });
  });

  it("charge les annonces plateforme même avec un établissement sélectionné, sans API scolaire", async () => {
    render(
      <MemoryRouter>
        <AnnouncementsPage />
      </MemoryRouter>,
    );
    await waitFor(() => expect(platformList).toHaveBeenCalled());
    expect(schoolList).not.toHaveBeenCalled();
    expect(screen.getByText("Annonce plateforme")).toBeInTheDocument();
    expect(screen.queryByText("Annonce scolaire")).not.toBeInTheDocument();
  });
});
