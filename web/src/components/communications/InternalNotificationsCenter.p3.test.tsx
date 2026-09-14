/**
 * AUDIT-COM-P3-02 — copies HTTP C4 inbox.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiError } from "../../api/client";

const { listSpy } = vi.hoisted(() => ({
  listSpy: vi.fn(),
}));

vi.mock("react-router-dom", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../../context/ActiveSchoolContext", () => ({
  useActiveSchool: () => ({ activeSchoolCode: "SCH-001" }),
}));

vi.mock("../../lib/usePermissionContext", () => ({
  useFeaturePermissions: () => ({ canCreate: false }),
  usePermissionContext: () => ({ user: null, rolePermissions: {} }),
}));

vi.mock("../../lib/internalNotificationsApi", () => ({
  internalNotificationsApi: {
    list: (...args: unknown[]) => listSpy(...args),
    unreadCount: vi.fn().mockResolvedValue({ count: 0 }),
    markRead: vi.fn(),
    archive: vi.fn(),
    downloadAttachment: vi.fn(),
    uploadAttachment: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("../../lib/internalNotificationsRead", () => ({
  notifyInternalNotificationsChanged: vi.fn(),
}));

vi.mock("../ui/Toast", () => ({
  useToast: () => ({ showToast: vi.fn() }),
}));

import { InternalNotificationsCenter } from "./InternalNotificationsCenter";

describe("AUDIT-COM-P3-02 — inbox C4 HTTP", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET inbox 403 affiche Accès refusé et HTTP 403", async () => {
    listSpy.mockRejectedValue(new ApiError("interdit API", 403));
    render(<InternalNotificationsCenter />);
    const banner = await screen.findByTestId("communication-http-error");
    expect(banner).toHaveAttribute("data-http-status", "403");
    expect(banner).toHaveTextContent("Accès refusé");
    expect(banner).toHaveTextContent("HTTP 403");
    expect(banner).not.toHaveTextContent("interdit API");
    expect(screen.getByRole("button", { name: "Réessayer" })).toBeInTheDocument();
  });
});
