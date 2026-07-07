import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { establishmentsApi, type SubscriptionAccessInfo } from "../lib/establishmentsApi";
import { isInternalSchoolRole } from "../lib/format";

/** Bandeau affiché quand l'abonnement établissement est limité ou suspendu (ETB-F14). */
export function SubscriptionAccessBanner() {
  const { session } = useAuth();
  const [access, setAccess] = useState<SubscriptionAccessInfo | null>(null);

  const role = session?.user?.role;
  const schoolCode = session?.user?.schoolCode;

  useEffect(() => {
    if (!session?.accessToken || !isInternalSchoolRole(role) || !schoolCode) {
      setAccess(null);
      return;
    }
    let cancelled = false;
    establishmentsApi
      .getSubscriptionAccess(schoolCode)
      .then((info) => {
        if (!cancelled) setAccess(info);
      })
      .catch(() => {
        if (!cancelled) setAccess(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.accessToken, role, schoolCode]);

  if (!access || access.level === "full") return null;

  const tone =
    access.level === "blocked"
      ? "border-danger/30 bg-danger/10 text-danger"
      : "border-amber/30 bg-amber/10 text-amber";

  return (
    <div className={`no-print mb-4 rounded-xl border px-4 py-3 text-sm ${tone}`}>
      <p className="font-semibold">
        {access.level === "blocked" ? "Accès suspendu" : "Accès limité"} — {access.plan || "Abonnement"}
      </p>
      <p className="mt-1 opacity-90">
        {access.message ||
          "Veuillez contacter l'administration de votre établissement ou régulariser votre abonnement."}
      </p>
      {access.level !== "blocked" ? (
        <Link to="/parametres/mon-abonnement" className="mt-2 inline-block text-sm font-semibold underline">
          Voir mon abonnement →
        </Link>
      ) : null}
    </div>
  );
}
