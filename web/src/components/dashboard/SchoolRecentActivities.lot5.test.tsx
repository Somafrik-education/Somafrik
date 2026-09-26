import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../api/client", () => ({ api: { get } }));
vi.mock("../../lib/dates", () => ({ formatDateTimeForDisplay: (date: string) => date }));

import { SchoolRecentActivities } from "./SchoolRecentActivities";

const entry = (id: string) => ({ id, label: "Classe créée", at: "2026-09-26T12:00:00Z" });

describe("LOT 5 — recent school activities", () => {
  beforeEach(() => get.mockReset());
  afterEach(() => vi.restoreAllMocks());

  it("never fetches activities for unauthorized roles", () => {
    render(<SchoolRecentActivities enabled={false} schoolKey="school-a" />);
    expect(get).not.toHaveBeenCalled();
    expect(screen.getByText(/réservées à l'administration/)).toBeInTheDocument();
  });

  it("handles malformed demo response without crashing the dashboard", async () => {
    get.mockResolvedValue({});
    render(<SchoolRecentActivities enabled schoolKey="school-a" />);
    expect(await screen.findByRole("alert")).toHaveTextContent("Actualisation indisponible");
  });

  it("discards an in-flight request from a previous establishment", async () => {
    let resolveOld!: (value: unknown) => void;
    get.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue({ items: [entry("new")], nextCursor: null });
    const { rerender } = render(<SchoolRecentActivities enabled schoolKey="school-a" />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender(<SchoolRecentActivities enabled schoolKey="school-b" />);
    expect(await screen.findByText("Classe créée")).toBeInTheDocument();
    await act(async () => resolveOld({ items: [entry("old")], nextCursor: null }));
    expect(screen.getAllByText("Classe créée")).toHaveLength(1);
  });
});
