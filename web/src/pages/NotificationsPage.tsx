import { Navigate } from "react-router-dom";
import { InternalNotificationsCenter } from "../components/communications/InternalNotificationsCenter";
import { useAuth } from "../context/AuthContext";
import { shouldDenyWebSchoolDomain } from "../lib/webSchoolDomainDeny";

/** Inbox établissement C4 — plus de catalogue plateforme sur cette route. */
export function NotificationsPage() {
  const { session } = useAuth();
  if (shouldDenyWebSchoolDomain(session?.user)) {
    return <Navigate to="/notifications-plateforme" replace />;
  }
  return <InternalNotificationsCenter />;
}
