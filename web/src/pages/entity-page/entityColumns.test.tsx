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
  it("construit les colonnes metadata Classes (sans Effectif legacy)", () => {
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
      "actions",
    ]);
    expect(columns.find((column) => column.key === "status")?.header).toBe("Statut");
    expect(columns.find((column) => column.key === "studentCount")).toBeUndefined();
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

  it("n'expose plus Dossier / Modifier / Supprimer pour les Élèves (CRUD EntityPage retiré)", () => {
    const module = getEntityModule("students")!;
    const columns = buildEntityColumns(baseCtx({ module }));
    renderActions(columns, { id: "stu-1", name: "Diop" });
    expect(screen.queryByRole("link", { name: "Dossier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
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

  it("masque Modifier / Supprimer selon les permissions (enseignants)", () => {
    const module = getEntityModule("teachers")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        canUpdate: false,
        allowDelete: false,
        assignmentCanCreateOrUpdate: false,
      }),
    );
    renderActions(columns, { id: "t1", name: "Diallo" });
    expect(screen.queryByRole("button", { name: "Modifier" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Supprimer" })).not.toBeInTheDocument();
  });

  it("n’expose plus le lien Élèves legacy sur Classes (CRUD retiré)", () => {
    const module = getEntityModule("classes")!;
    const columns = buildEntityColumns(
      baseCtx({
        module,
        studentsCanRead: true,
      }),
    );
    renderActions(columns, { id: "c1", name: "6ème A" });
    expect(screen.queryByRole("link", { name: "Élèves" })).not.toBeInTheDocument();
  });

  it("rend les noms d’élèves séparés pour les cellules multi-valeurs", () => {
    render(<>{renderSeparatedStudentNames(["Awa Diop", "Ibrahima Fall"])}</>);
    expect(screen.getByText("Awa Diop")).toBeInTheDocument();
    expect(screen.getByText("Ibrahima Fall")).toBeInTheDocument();
  });
});
