import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ClassHeadTeacherAssignModal } from "./ClassHeadTeacherAssignModal";
import type { SchoolClass } from "../../lib/classesApi";
import { ApiError } from "../../api/client";

const confirmMock = vi.hoisted(() => vi.fn(async () => true));
const classesApiMock = vi.hoisted(() => ({
  listHeadTeacherCandidates: vi.fn(),
  assignHeadTeacher: vi.fn(),
  removeHeadTeacher: vi.fn(),
}));

vi.mock("../../lib/classesApi", () => ({
  classesApi: classesApiMock,
}));

vi.mock("../../components/ui/ConfirmDialog", () => ({
  useConfirm: () => ({ confirm: confirmMock }),
}));

const CLASS_ROW: SchoolClass = {
  id: "CLS-1",
  publicId: "CLS-1",
  classCode: "CLS-1",
  name: "6ème A",
  level: "6ème",
  section: "A",
  track: "",
  groupCode: "A",
  status: "active",
  schoolCode: "CD-IN-26-001",
  academicYearId: "ay-1",
  academicYearName: "2025-2026",
  schoolYear: "2025-2026",
  students: 2,
};

describe("ClassHeadTeacherAssignModal", () => {
  beforeEach(() => {
    confirmMock.mockResolvedValue(true);
    classesApiMock.listHeadTeacherCandidates.mockResolvedValue([
      {
        teacherCode: "SCH-A-ENS-0001",
        firstName: "Awa",
        lastName: "Diop",
        displayName: "Awa DIOP",
        otherClassNames: ["5ème B"],
        alreadyHeadTeacherHint: "Déjà professeur principal de 5ème B",
      },
    ]);
    classesApiMock.assignHeadTeacher.mockReset();
    classesApiMock.removeHeadTeacher.mockReset();
  });

  it("liste uniquement les candidats renvoyés par l'API (enseignants actifs du même établissement)", async () => {
    render(
      <ClassHeadTeacherAssignModal
        open
        schoolClass={CLASS_ROW}
        onClose={vi.fn()}
        onAssigned={vi.fn()}
        onRemoved={vi.fn()}
        onError={vi.fn()}
      />,
    );
    expect(await screen.findByText("Awa DIOP")).toBeInTheDocument();
    expect(screen.getByText("Déjà professeur principal de 5ème B")).toBeInTheDocument();
    expect(screen.queryByText("Cross TENANT")).not.toBeInTheDocument();
  });

  it("remplace le professeur principal", async () => {
    const user = userEvent.setup();
    const onAssigned = vi.fn();
    classesApiMock.assignHeadTeacher.mockResolvedValue({
      ...CLASS_ROW,
      teacherId: "SCH-A-ENS-0001",
      headTeacherDisplayName: "Awa DIOP",
    });
    render(
      <ClassHeadTeacherAssignModal
        open
        schoolClass={{ ...CLASS_ROW, teacherId: "SCH-A-ENS-0002", headTeacherCode: "SCH-A-ENS-0002" }}
        onClose={vi.fn()}
        onAssigned={onAssigned}
        onRemoved={vi.fn()}
        onError={vi.fn()}
      />,
    );
    await screen.findByText("Awa DIOP");
    await user.click(screen.getByLabelText(/Awa DIOP/i));
    await user.click(screen.getByRole("button", { name: /Confirmer l.affectation/ }));
    await waitFor(() => expect(onAssigned).toHaveBeenCalled());
    expect(classesApiMock.assignHeadTeacher).toHaveBeenCalledWith("CLS-1", "SCH-A-ENS-0001");
  });

  it("retire l'affectation après confirmation", async () => {
    const user = userEvent.setup();
    const onRemoved = vi.fn();
    classesApiMock.removeHeadTeacher.mockResolvedValue({ ...CLASS_ROW, teacherId: "", headTeacher: null });
    render(
      <ClassHeadTeacherAssignModal
        open
        schoolClass={{ ...CLASS_ROW, teacherId: "SCH-A-ENS-0001", headTeacherCode: "SCH-A-ENS-0001" }}
        onClose={vi.fn()}
        onAssigned={vi.fn()}
        onRemoved={onRemoved}
        onError={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /Retirer l.affectation/ }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(onRemoved).toHaveBeenCalled();
  });

  it("n'applique pas de fausse mise à jour si le réseau échoue", async () => {
    const user = userEvent.setup();
    const onAssigned = vi.fn();
    const onError = vi.fn();
    classesApiMock.assignHeadTeacher.mockRejectedValue(new ApiError("timeout", 503));
    render(
      <ClassHeadTeacherAssignModal
        open
        schoolClass={CLASS_ROW}
        onClose={vi.fn()}
        onAssigned={onAssigned}
        onRemoved={vi.fn()}
        onError={onError}
      />,
    );
    await screen.findByText("Awa DIOP");
    await user.click(screen.getByLabelText(/Awa DIOP/i));
    await user.click(screen.getByRole("button", { name: /Confirmer l.affectation/ }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onAssigned).not.toHaveBeenCalled();
  });
});
