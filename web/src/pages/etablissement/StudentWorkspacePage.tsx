import { Link, Navigate, useParams } from "react-router-dom";
import { StudentWorkspaceSummary } from "../../components/students/StudentWorkspaceSummary";
import { Card } from "../../components/ui/Card";
import { useStudentWorkspace } from "../../hooks/useStudentWorkspace";

export function StudentWorkspacePage() {
  const { studentId = "" } = useParams();
  const normalizedStudentId = studentId.trim();
  const { workspace, loading, error } = useStudentWorkspace(normalizedStudentId);

  if (!normalizedStudentId) {
    return <Navigate to="/etablissement/eleves" replace />;
  }

  if (loading) {
    return (
      <Card className="p-6">
        <p className="text-sm text-muted">Chargement de la fiche élève…</p>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="p-6">
        <p className="font-semibold text-danger">
          Impossible de charger la fiche élève.
        </p>
        <p className="mt-2 text-sm text-muted">{error}</p>
      </Card>
    );
  }

  if (!workspace) {
    return (
      <Card className="p-6">
        <p className="font-semibold">Élève introuvable</p>
        <Link
          className="mt-3 inline-flex text-sm font-semibold text-brand"
          to="/etablissement/eleves"
        >
          Retour à la liste des élèves
        </Link>
      </Card>
    );
  }

  return <StudentWorkspaceSummary workspace={workspace} />;
}
