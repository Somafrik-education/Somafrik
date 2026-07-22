import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Table } from "./Table";

type Row = { id: string; name: string; score: number };

const rows: Row[] = [
  { id: "1", name: "Bêta", score: 10 },
  { id: "2", name: "Alpha", score: 20 },
];

describe("Table", () => {
  it("renders headers and cells", () => {
    render(
      <Table
        columns={[
          { key: "name", header: "Nom" },
          { key: "score", header: "Score" },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Nom/i })).toBeInTheDocument();
    expect(screen.getByText("Bêta")).toBeInTheDocument();
  });

  it("shows empty label when no rows", () => {
    render(
      <Table
        columns={[{ key: "name", header: "Nom" }]}
        rows={[]}
        rowKey={(_, i) => String(i)}
        emptyLabel="Vide"
      />,
    );
    expect(screen.getByText("Vide")).toBeInTheDocument();
  });

  it("sorts when sortable is enabled", async () => {
    const user = userEvent.setup();
    render(
      <Table
        sortable
        columns={[{ key: "name", header: "Nom" }]}
        rows={rows}
        rowKey={(row) => row.id}
      />,
    );
    await user.click(screen.getByRole("columnheader", { name: /Nom/i }));
    const cells = screen.getAllByRole("cell");
    expect(cells[0]).toHaveTextContent("Alpha");
  });
});
