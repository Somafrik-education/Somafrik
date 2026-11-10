import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
const sessionUser = vi.hoisted(() => ({
  role: "Super Administrateur Somafrik",
  permissions: ["ALL_PRIVILEGES"],
  schoolCode: "*",
}));

vi.mock("../context/AuthContext", () => ({
  useAuth: () => ({ session: { user: sessionUser } }),
}));

vi.mock("../components/communications/InternalNotificationsCenter", () => ({
  InternalNotificationsCenter: () => <div>Inbox C4</div>,
}));

import { NotificationsPage } from "./NotificationsPage";

describe("P1-07 NotificationsPage — Superadmin hors Inbox C4", () => {
  it("redirige Superadmin vers le catalogue plateforme", () => {
    render(
      <MemoryRouter initialEntries={["/notifications"]}>
        <Routes>
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="/notifications-plateforme" element={<div>Catalogue plateforme</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Catalogue plateforme")).toBeInTheDocument();
    expect(screen.queryByText("Inbox C4")).not.toBeInTheDocument();
  });
});
