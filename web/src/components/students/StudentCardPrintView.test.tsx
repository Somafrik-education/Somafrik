import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudentCardPrintView } from "./StudentCardPrintView";

const qrToDataUrl = vi.hoisted(() => vi.fn(async (value: string, options?: unknown) => {
  void options;
  return `data:image/png;base64,${value.length}`;
}));

vi.mock("qrcode", () => ({
  default: { toDataURL: (value: string, options?: unknown) => qrToDataUrl(value, options) },
}));

describe("StudentCardPrintView", () => {
  it("encode exactement le cardToken, au format CR80, sans secret en clair", async () => {
    render(
      <StudentCardPrintView
        cardToken="CARD-A.TOKEN-1"
        identity={{
          displayName: "Kabila Amina",
          classLabel: "6ème A",
          studentCode: "CD-001",
          schoolName: "Lycée Test",
          photoUrl: null,
          publicId: "CARD-A",
        }}
        school={{
          code: "CD-1",
          hasLogo: true,
          logoSource: "school_upload",
          logoUploadedAt: "2026-10-01T00:00:00.000Z",
        }}
        onClose={() => undefined}
      />,
    );
    const sheet = await screen.findByTestId("student-card-sheet");
    expect(sheet).toHaveStyle({ width: "85.60mm", height: "53.98mm" });
    expect(screen.getByRole("button", { name: "Imprimer" })).toBeInTheDocument();
    expect(screen.getByText("Kabila Amina")).toBeInTheDocument();
    expect(screen.getByText("ID carte : CARD-A")).toBeInTheDocument();
    expect(qrToDataUrl).toHaveBeenCalledWith("CARD-A.TOKEN-1", expect.any(Object));
    expect(document.body.textContent).not.toContain("TOKEN-1");
    expect(document.body.innerHTML).not.toContain("CARD-A.TOKEN-1");
    expect(document.body.textContent).not.toContain("parentPhone");
    expect(document.querySelector('img[src*="/logo"]')).toBeTruthy();
  });
});
