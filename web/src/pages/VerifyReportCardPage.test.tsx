import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const verifyCapability = vi.hoisted(() => vi.fn());

vi.mock("../lib/reportCardVerifyApi", () => ({
  verifyReportCardCapability: (...args: unknown[]) => verifyCapability(...args),
}));

const snapshot = {
  report_card_id: "rc-1",
  published_snapshot_version: 1,
  students: [
    {
      student_id: "STU-1",
      cells: [],
      slots: [{ slot: "TOTAL", exposed: "14.00" }],
      presence: [],
    },
  ],
};

describe("LOT 7 public verify page", () => {
  beforeEach(() => {
    verifyCapability.mockReset();
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("report-card-lot7-web-public-verify-valid", async () => {
    verifyCapability.mockResolvedValue({
      ok: true,
      payload: snapshot,
      verification_status: "authentic",
    });
    const mod = await import("./VerifyReportCardPage");
    const replaceState = vi.spyOn(window.history, "replaceState");
    render(
      <MemoryRouter initialEntries={["/verify/rc/pub-1.secret-token-value"]}>
        <Routes>
          <Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/authentique/i)).toBeInTheDocument());
    expect(screen.getByText("14.00")).toBeInTheDocument();
    expect(verifyCapability).toHaveBeenCalledWith("pub-1.secret-token-value");
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });

  it("report-card-lot7-web-public-verify-invalid", async () => {
    verifyCapability.mockResolvedValue({ ok: false, reason: "not_found" });
    const mod = await import("./VerifyReportCardPage");
    render(
      <MemoryRouter initialEntries={["/verify/rc/unknown.badtoken"]}>
        <Routes>
          <Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/introuvable|non v[eé]rifiable/i)).toBeInTheDocument());
    expect(screen.queryByText("14.00")).not.toBeInTheDocument();
    expect(screen.queryByText(/stack|token_hash|secret-token/i)).not.toBeInTheDocument();
  });

  it("report-card-lot7-web-capability-not-persisted", async () => {
    verifyCapability.mockResolvedValue({
      ok: true,
      payload: snapshot,
      verification_status: "authentic",
    });
    const mod = await import("./VerifyReportCardPage");
    const setItemLocal = vi.spyOn(Storage.prototype, "setItem");
    render(
      <MemoryRouter initialEntries={["/verify/rc/pub-1.secret-token-value"]}>
        <Routes>
          <Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/authentique/i)).toBeInTheDocument());
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
    const stored = setItemLocal.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(stored.includes("secret-token-value")).toBe(false);
    setItemLocal.mockRestore();
  });
});
