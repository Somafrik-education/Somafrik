import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { isLinkedParentStudent } from "./canonicalStudentIdentity";

/**
 * Un studentId de route sert uniquement à initialiser un deep-link Parent valide.
 * Après cette initialisation, le StudentSwitcher reste la source de vérité.
 */
export function useParentStudentRouteSelection(routeStudentId?: string | null) {
  const { session, selectedStudentId, setSelectedStudentId } = useAuth();
  const appliedRouteRef = useRef("");

  useEffect(() => {
    const requested = String(routeStudentId ?? "").trim();
    if (session?.role !== "parent_student" || !requested) return;
    if (appliedRouteRef.current === requested) return;

    appliedRouteRef.current = requested;

    if (!isLinkedParentStudent({ user: session.user, selectedStudentId: requested })) return;
    if (requested === String(selectedStudentId ?? "").trim()) return;

    setSelectedStudentId(requested);
  }, [
    routeStudentId,
    selectedStudentId,
    session?.role,
    session?.user,
    setSelectedStudentId,
  ]);
}
