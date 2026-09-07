import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/AuthContext";
import { useData } from "../../context/DataContext";
import { scopedSchools } from "../../lib/scope";
import { platformApi } from "../../lib/platformApi";
import { buildStandardTrialSubscriptionPayload } from "../../lib/trialAccessActivation";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import { ApiError } from "../../api/client";
import { normalize } from "../../lib/format";

/** Consomme GET /api/backoffice/trial-requests. */

type TrialRequestRow = {
  id: string;
  publicRef?: string;
  requesterName?: string;
  role?: string;
  schoolName?: string;
  countryIso?: string;
  city?: string;
  phone?: string;
  email?: string;
  studentBand?: string;
  status?: string;
  createdAt?: string;
};

const STATUS_LABELS: Record<string, string> = {
  nouvelle: "nouvelle",
  contactee: "contactée",
  qualifiee: "qualifiée",
  essai_active: "essai activé",
  convertie: "convertie",
  refusee: "refusée",
  abandonnee: "abandonnée",
};

export function TrialRequestsPage() {
  const { session } = useAuth();
  const { state, refresh } = useData();
  const { showToast } = useToast();
  const [rows, setRows] = useState<TrialRequestRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [schoolByRequest, setSchoolByRequest] = useState<Record<string, string>>({});

  const schools = scopedSchools(session?.user ?? null, state);
  const schoolOptions = useMemo(
    () => schools.map((school) => ({ value: school.code, label: `${school.name} (${school.code})` })),
    [schools],
  );

  async function load() {
    setLoading(true);
    try {
      const listed = await platformApi.listTrialRequests();
      setRows(Array.isArray(listed) ? (listed as TrialRequestRow[]) : []);
    } catch {
      showToast("Impossible de charger les demandes d'essai", "error");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function activate(row: TrialRequestRow) {
    const schoolCode = schoolByRequest[row.id] ?? "";
    const school = schools.find((item) => normalize(item.code) === normalize(schoolCode));
    if (!school) {
      showToast("Sélectionnez un établissement existant pour activer l'essai", "error");
      return;
    }
    setBusyId(row.id);
    try {
      const payload = buildStandardTrialSubscriptionPayload(school);
      await platformApi.upsertSubscription({ ...payload, schoolCode: school.code } as unknown as Record<string, unknown>);
      await refresh();
      showToast("Essai Standard de 30 jours activé", "success");
    } catch (error) {
      const message =
        error instanceof ApiError && error.message
          ? error.message
          : "Échec de l'activation (un seul essai par établissement)";
      showToast(message, "error");
    } finally {
      setBusyId("");
    }
  }

  return (
    <Card className="p-6">
      <SectionHeader
        title="Demandes d'essai"
        description="Inbox Superadmin. Le formulaire public ne crée pas d'établissement, d'utilisateur ni d'abonnement."
      />
      {loading ? (
        <p className="text-sm text-muted">Chargement…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">Aucune demande d'essai pour le moment.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                <th className="py-2 pr-3">Demandeur</th>
                <th className="py-2 pr-3">Établissement</th>
                <th className="py-2 pr-3">Contact</th>
                <th className="py-2 pr-3">Statut</th>
                <th className="py-2 pr-3">Activation Standard 30 jours</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-b border-line/70 align-top">
                  <td className="py-3 pr-3">
                    <div className="font-bold text-ink">{row.requesterName || "—"}</div>
                    <div className="text-xs text-muted">{row.role || ""}</div>
                    <div className="text-xs text-muted">{row.publicRef || row.id}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="font-semibold">{row.schoolName || "—"}</div>
                    <div className="text-xs text-muted">
                      {[row.city, row.countryIso].filter(Boolean).join(" · ")}
                    </div>
                    <div className="text-xs text-muted">{row.studentBand || ""}</div>
                  </td>
                  <td className="py-3 pr-3">
                    <div>{row.email}</div>
                    <div className="text-xs text-muted">{row.phone}</div>
                  </td>
                  <td className="py-3 pr-3 font-semibold">
                    {STATUS_LABELS[String(row.status ?? "nouvelle")] ?? row.status ?? "nouvelle"}
                  </td>
                  <td className="space-y-2 py-3 pr-3">
                    <Select
                      value={schoolByRequest[row.id] ?? ""}
                      onChange={(event) =>
                        setSchoolByRequest((current) => ({ ...current, [row.id]: event.target.value }))
                      }
                      options={[
                        { value: "", label: "Établissement existant" },
                        ...schoolOptions,
                      ]}
                    />
                    <Button
                      type="button"
                      disabled={busyId === row.id}
                      onClick={() => void activate(row)}
                    >
                      Activer l'essai Standard
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
