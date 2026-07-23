import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { getEntityModule } from "../../lib/entityModules";
import {
  buildEntityColumns,
  relationColumnHeader,
  renderSeparatedStudentNames,
  PARENT_CHILD_COLUMNS,
  type BuildEntityColumnsContext,
} from "./entityColumns";

function baseCtx(
  overrides: Partial<BuildEntityColumnsContext> & Pick<BuildEntityColumnsContext, "module">,
): BuildEntityColumnsContext {
  return {
    isParentChildMode: false,
    busy: false,
    canUpdate: true,
    allowDelete: true,
    studentsCanRead: true,
    assignmentCanCreateOrUpdate: true,
    users: [],
    students: [],
    scopedStudents: [],
    scopedAssignments: [],
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAssignTeacher: vi.fn(),
    onShowPaymentReceipt: vi.fn(),
    onCancelPayment: vi.fn(),
    ...overrides,
  };
}

function renderActions(columns: ReturnType<typeof buildEntityColumns>, row: Record<string, unknown>) {
  const actions = columns.find((column) => column.key === "actions");
  expect(actions?.render).toBeDefined();
  render(<MemoryRouter>{actions!.render!(row)}</MemoryRouter>);
}

describe("entityColumns (D2.8a)", () => {
  it("construit les colonnes standard Classes + Effectif", () => {
    const module = getEntityModule("classes")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        scopedStudents: [
          { id: "s1", className: "6ème A" },
          { id: "s2", className: "6ème A" },
        ],
      }),
    );

    expect(columns.map((column) => column.key)).toEqual([
      "name",
      "level",
      "track",
      "status",
      "studentCount",
      "actions",
    ]);
    expect(columns.find((column) => column.key === "status")?.header).toBe("Statut");
    expect(columns.find((column) => column.key === "studentCount")?.render?.({ name: "6ème A" })).toBe(
      "2",
    );
  });

  it("construit les colonnes standard Enseignants", () => {
    const module = getEntityModule("teachers")!;
    const columns = buildEntityColumns(baseCtx({ module }));
    expect(columns.map((column) => column.key)).toEqual([
      "name",
      "firstName",
      "publicId",
      "specialty",
      "assignmentsSummary",
      "actions",
    ]);
    expect(
      columns.find((column) => column.key === "publicId")?.render?.({ publicId: "SN-ENS-1" }),
    ).toContain("connexion");
  });

  it("expose l’action Dossier pour les Élèves", () => {
    const module = getEntityModule("students")!;
    const columns = buildEntityColumns(baseCtx({ module }));
    renderActions(columns, { id: "stu-1", name: "Diop" });
    expect(screen.getByRole("link", { name: "Dossier" })).toHaveAttribute(
      "href",
      "/etablissement/eleves/stu-1",
    );
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Supprimer" })).toBeInTheDocument();
  });

  it("utilise les colonnes parent-enfant en mode dédié", () => {
    const module = getEntityModule("relations")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        isParentChildMode: true,
        users: [{ id: "u1", name: "Parent", firstName: "A" }],
        students: [{ id: "s1", name: "Enfant", firstName: "B" }],
      }),
    );
    expect(columns.map((column) => column.key)).toEqual([...PARENT_CHILD_COLUMNS, "actions"]);
    expect(relationColumnHeader("fromContactName", module, true)).toBe("Parent");
    expect(relationColumnHeader("toStudentName", module, true)).toBe("Élève(s)");
  });

  it("masque Modifier / Supprimer selon les permissions", () => {
    const module = getEntityModule("students")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        canUpdate: false,
        allowDelete: false,
      }),
    );
    renderActions(columns, { id: "stu-1", name: "Diop" });
    expect(screen.getByRole("link", { name: "Dossier" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  });

  it("masque le lien Élèves sur Classes sans permission students", () => {
    const module = getEntityModule("classes")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        studentsCanRead: false,
      }),
    );
    renderActions(columns, { id: "c1", name: "6ème A" });
    expect(screen.queryByRole("link", { name: "Élèves" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Modifier" })).toBeInTheDocument();
  });

  it("rend les noms d’élèves séparés pour les cellules multi-valeurs", () => {
    render(<>{renderSeparatedStudentNames(["Awa Diop", "Ibrahima Fall"])}</>);
    expect(screen.getByText("Awa Diop")).toBeInTheDocument();
    expect(screen.getByText("Ibrahima Fall")).toBeInTheDocument();
  });
});
