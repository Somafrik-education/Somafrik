import { useEffect, useRef } from "react";
import { useAuth } from "../context/AuthContext";
import { isLinkedParentStudent } from "./canonicalStudentIdentity";

/**
 * Un route param parent sert uniquement à initialiser un deep-link valide.
 * Une fois appliqué, le StudentSwitcher reste la source de vérité.
 */
export function useParentStudentRouteSelection(routeStudentId?: string | null) {
  const { session, selectedStudentId, setSelectedStudentId } = useAuth();
  const appliedRef = useRef("");

  useEffect(() => {
    const requested = String(routeStudentId ?? "").trim();
    if (session?.role !== "parent_student" || !requested) return;
    if (appliedRef.current === requested) return;
    appliedRef.current = requested;
    if (!isLinkedParentStudent({ user: session.user, selectedStudentId: requested })) return;
    setSelectedStudentId(requested);
  }, [routeStudentId, session?.role, session?.user, setSelectedStudentId]);

  return { session, selectedStudentId };
}
