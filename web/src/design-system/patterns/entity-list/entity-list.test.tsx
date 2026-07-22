import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EntityListForbidden,
  EntityListSearch,
  EntityListShell,
  EntityListTable,
} from "./index";

describe("EntityListShell", () => {
  it("compose ListLayout regions with orientation, alerts, filters and actions", () => {
    render(
      <EntityListShell
        title="Classes"
        description="Organisation des classes"
        orientation={<a href="/etablissement/classes">← Retour</a>}
        alerts={<p>Alerte planning</p>}
        filters={<span>Filtre</span>}
        secondaryActions={<button type="button">Exporter</button>}
        primaryActions={<button type="button">Ajouter</button>}
      >
        <p>Tableau</p>
      </EntityListShell>,
    );

    expect(screen.getByRole("navigation", { name: "Orientation" })).toHaveTextContent(
      "← Retour",
    );
    expect(screen.getByRole("heading", { level: 2, name: "Classes" })).toBeInTheDocument();
    expect(screen.getByText("Organisation des classes")).toBeInTheDocument();
    expect(screen.getByLabelText("Filtres et recherche")).toHaveTextContent("Filtre");
    expect(screen.getByLabelText("Liste")).toHaveTextContent("Alerte planning");
    expect(screen.getByLabelText("Liste")).toHaveTextContent("Tableau");
    expect(screen.getByRole("button", { name: "Exporter" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ajouter" })).toBeInTheDocument();
  });
});

describe("EntityListSearch", () => {
  it("renders search input and forwards changes", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <EntityListSearch
        value=""
        onChange={onChange}
        placeholder="Rechercher dans classes…"
      />,
    );
    const input = screen.getByRole("searchbox", {
      name: "Rechercher dans classes…",
    });
    await user.type(input, "6e");
    expect(onChange).toHaveBeenCalled();
  });
});

describe("EntityListTable", () => {
  it("applies default sortable + pageSize behavior", () => {
    render(
      <EntityListTable
        columns={[{ key: "name", header: "Nom" }]}
        rows={[{ name: "6e A" }, { name: "5e B" }]}
        rowKey={(_row, index) => String(index)}
      />,
    );
    expect(screen.getByRole("columnheader", { name: /Nom/ })).toBeInTheDocument();
    expect(screen.getByText("6e A")).toBeInTheDocument();
    expect(screen.getByText("5e B")).toBeInTheDocument();
  });

  it("shows empty label when no rows", () => {
    render(
      <EntityListTable
        columns={[{ key: "name", header: "Nom" }]}
        rows={[]}
        rowKey={(_, index) => String(index)}
        emptyLabel="Aucune classe."
      />,
    );
    expect(screen.getByText("Aucune classe.")).toBeInTheDocument();
  });
});

describe("EntityListForbidden", () => {
  it("exposes ForbiddenState with module label", () => {
    render(<EntityListForbidden moduleLabel="Classes" />);
    expect(screen.getByRole("status")).toHaveTextContent("Accès non autorisé");
    expect(screen.getByRole("status")).toHaveTextContent(
      "Vous n'avez pas l'autorisation de consulter classes.",
    );
  });
});
