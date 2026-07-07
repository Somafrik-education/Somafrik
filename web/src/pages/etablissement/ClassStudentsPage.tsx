import { Navigate, useParams } from "react-router-dom";
import { EntityPage } from "../EntityPage";

/** Gestion des élèves d'une classe (depuis Mon établissement → Classes). */
export function ClassStudentsPage() {
  const { className = "" } = useParams();
  const decoded = decodeURIComponent(className).trim();

  if (!decoded) {
    return <Navigate to="/etablissement/classes" replace />;
  }

  return <EntityPage entity="students" classScope={decoded} />;
}
