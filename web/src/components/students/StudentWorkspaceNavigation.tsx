import { NavLink } from "react-router-dom";
import type { StudentWorkspaceModule } from "../../lib/studentWorkspace";
import { buildStudentWorkspacePath } from "../../lib/studentWorkspaceNavigation";
import { cn } from "../../lib/utils";

interface StudentWorkspaceNavigationProps {
  studentId: string;
  modules: readonly StudentWorkspaceModule[];
}

export function StudentWorkspaceNavigation({
  studentId,
  modules,
}: StudentWorkspaceNavigationProps) {
  return (
    <nav
      className="-mx-1 flex items-center gap-1 overflow-x-auto border-b border-line px-1"
      aria-label="Sections du dossier élève"
    >
      {modules.map((module) => {
        const to = buildStudentWorkspacePath(studentId, module.id);

        return (
          <NavLink
            key={module.id}
            to={to}
            end={module.id === "overview"}
            className={({ isActive }) =>
              cn(
                "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 py-2.5 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/30",
                isActive
                  ? "border-brand text-brand"
                  : "border-transparent text-slate-600 hover:border-line hover:text-ink",
              )
            }
          >
            {module.title}
          </NavLink>
        );
      })}
    </nav>
  );
}
