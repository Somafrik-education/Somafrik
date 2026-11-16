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
    expect(screen.getByText(/format historique/i)).toBeInTheDocument();
    expect(screen.queryByText("STU-1")).not.toBeInTheDocument();
    expect(screen.queryByText("rc-1")).not.toBeInTheDocument();
    expect(verifyCapability).toHaveBeenCalledWith("pub-1.secret-token-value");
    expect(replaceState).toHaveBeenCalled();
    replaceState.mockRestore();
  });


  it("QR verified: displays the same official header, subject table and signatures, never technical snapshot IDs", async () => {
    verifyCapability.mockResolvedValue({
      ok: true,
      payload: snapshot,
      verification_status: "authentic",
      presentation: [{
        official: true,
        report_card_id: "rc-1",
        version: 1,
        verification_status: "authentic",
        published_at: "2026-11-05",
        period_scope: "T1",
        style: "simple",
        school: { name: "Institut Nuruyetu" },
        class_name: "2ème A",
        academic_year: "2026-2027",
        student: { code: "S-1", name: "Matayo Papy" },
        periods: [{ id: "T1", label: "Trimestre 1" }],
        components: [{ id: "TJ", label: "TJ" }],
        rows: [],
        totals: { periods: { T1: null }, annual: null },
        status: "COMPLETE",
        cohort_size: 9,
        issues: [],
        decision: null,
        signatures: ["Parent", "Titulaire", "Directeur"],
        header: {
          layout: "logo_left",
          title: "Bulletin scolaire",
          title_align: "center",
          lines: ["République Démocratique du Congo"],
          items: [{ id: "establishment_name", label: "Établissement", value: "Institut Nuruyetu" }],
          logo: null,
        },
      }],
    });
    const mod = await import("./VerifyReportCardPage");
    render(
      <MemoryRouter initialEntries={["/verify/rc/public.capability"]}>
        <Routes><Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} /></Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByTestId("report-card-header-title")).toHaveTextContent("Bulletin scolaire"));
    expect(screen.getByTestId("report-card-header-title")).toHaveClass("text-center");
    expect(screen.getByTestId("report-card-presentation")).toHaveAttribute("data-official", "true");
    expect(screen.getByTestId("report-card-identity")).toHaveTextContent("Institut Nuruyetu");
    expect(screen.getByTestId("report-card-signatures")).toHaveTextContent("Directeur");
    expect(screen.queryByText(/rc-1/)).not.toBeInTheDocument();
    expect(screen.queryByText("14.00")).not.toBeInTheDocument();
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

  it("report-card-lot7-web-public-verify-revoked-not-authentic", async () => {
    verifyCapability.mockResolvedValue({
      ok: true,
      payload: snapshot,
      verification_status: "revoked",
    });
    const mod = await import("./VerifyReportCardPage");
    render(
      <MemoryRouter initialEntries={["/verify/rc/pub-1.secret-token-value"]}>
        <Routes>
          <Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/révoqué/i)).toBeInTheDocument());
    expect(screen.queryByText(/Bulletin authentique/i)).not.toBeInTheDocument();
  });

  it("report-card-lot7-web-public-verify-transport-unavailable", async () => {
    verifyCapability.mockRejectedValue(new Error("network down"));
    const mod = await import("./VerifyReportCardPage");
    render(
      <MemoryRouter initialEntries={["/verify/rc/pub-1.secret-token-value"]}>
        <Routes>
          <Route path="/verify/rc/:capability" element={<mod.VerifyReportCardPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/indisponible/i)).toBeInTheDocument());
    expect(screen.queryByText(/Vérification…/)).not.toBeInTheDocument();
  });
});
