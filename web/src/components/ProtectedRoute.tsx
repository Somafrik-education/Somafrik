import type { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, session } = useAuth();
  if (!isAuthenticated) {
    return <Navigate to="/connexion" replace />;
  }
  if (session?.user?.mustChangePassword) {
    return <Navigate to="/connexion" replace />;
  }
  return <>{children}</>;
}
