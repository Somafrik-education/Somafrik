import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Card, SectionHeader } from "../components/ui/Card";
import { Field, Select } from "../components/ui/Field";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { scopedGrades } from "../lib/evaluations";
import { formatFinanceAmount } from "../lib/financeCurrency";
import { parentGradesKpis, parentLinkedStudents, parentStudentLabel } from "../lib/parentNotes";

function rowKeys(row: Record<string, unknown> | null | undefined) {
  if (!row) return [];
  return [row.id, row.studentId, row.studentUuid, row.publicId, row.matricule, row.studentCode]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
}

function studentRowMatches(row: Record<string, unknown>, keys: Set<string>) {
  const candidates = [row.studentId, row.studentUuid, row.studentCode, row.matricule, row.publicId]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  return candidates.some((value) => keys.has(value));
}

function presenceIsAttended(row: Record<string, unknown>) {
  const status = String(row.status ?? row.presence ?? "").trim().toLowerCase();
  return status === "présent" || status === "present" || status === "retard" || status === "late";
}

export function ParentDashboardPage() {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();
  const user = session?.user ?? null;
  const schoolCode = String(user?.schoolCode ?? "").trim();
  const children = useMemo(() => parentLinkedStudents(user, state), [user, state]);
  const [selectedStudentId, setSelectedStudentId] = useState("");

  useEffect(() => {
    void ensureDomains(
      ["students", "notes", "presences", "payments", "studentFees", "messages", "announcements"],
      schoolCode ? { schoolCode } : undefined,
    ).catch(() => undefined);
  }, [ensureDomains, schoolCode]);

  useEffect(() => {
    if (!children.length) {
      setSelectedStudentId("");
      return;
    }
    if (!children.some((child) => String(child.id ?? "") === selectedStudentId)) {
      setSelectedStudentId(String(children[0].id ?? ""));
    }
  }, [children, selectedStudentId]);

  const selectedChild =
    children.find((child) => String(child.id ?? "") === selectedStudentId) ?? children[0] ?? null;
  const selectedKeys = useMemo(() => new Set(rowKeys(selectedChild)), [selectedChild]);

  const selectedGrades = useMemo(
    () =>
      scopedGrades(user, state).filter((grade) =>
        selectedKeys.has(String(grade.studentId ?? "").trim()),
      ),
    [user, state, selectedKeys],
  );
  const gradeKpis = parentGradesKpis(selectedGrades);

  const selectedPresences = useMemo(
    () =>
      (state.presences as Record<string, unknown>[]).filter((row) =>
        studentRowMatches(row, selectedKeys),
      ),
    [state.presences, selectedKeys],
  );
  const attended = selectedPresences.filter(presenceIsAttended).length;
  const presenceRate = selectedPresences.length
    ? Math.round((attended / selectedPresences.length) * 100)
    : null;

  const selectedFees = useMemo(
    () =>
      (state.studentFees ?? []).filter((row) =>
        selectedKeys.has(String(row.studentId ?? "").trim()),
      ),
    [state.studentFees, selectedKeys],
  );
  const remaining = selectedFees.reduce((sum, row) => sum + Number(row.balance ?? 0), 0);
  const paid = selectedFees.reduce((sum, row) => sum + Number(row.amountPaid ?? 0), 0);
  const currency = String(selectedFees.find((row) => row.currency)?.currency ?? "");

  const unreadMessages = (state.messages as Record<string, unknown>[]).filter(
    (row) => !row.readAt && !row.read_at,
  ).length;
  const latestAnnouncement = (state.announcements as Record<string, unknown>[])[0];

  return (
    <div className="space-y-6" data-testid="parent-dashboard">
      <SectionHeader
        title="Espace parent"
        description="Suivi scolaire, financier et communication pour vos enfants liés."
      />

      {children.length > 1 ? (
        <Card className="p-4">
          <Field label="Enfant">
            <Select
              aria-label="Enfant"
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              options={children.map((child) => ({
                value: String(child.id ?? ""),
                label: parentStudentLabel(child),
              }))}
            />
          </Field>
        </Card>
      ) : null}

      {selectedChild ? (
        <Card className="p-5">
          <p className="text-xs font-black uppercase tracking-wide text-brand">Enfant suivi</p>
          <h2 className="mt-1 text-xl font-black text-ink">{parentStudentLabel(selectedChild)}</h2>
          <p className="mt-1 text-sm font-semibold text-muted">
            {String(selectedChild.className ?? "Classe non renseignée")}
          </p>
        </Card>
      ) : (
        <Card className="p-5">
          <p className="text-sm font-semibold text-muted">Aucun enfant lié à ce compte.</p>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ParentMetric
          label="Présence"
          value={presenceRate == null ? "—" : `${presenceRate}%`}
          detail={selectedPresences.length ? `${attended}/${selectedPresences.length} présence(s)` : "Aucune donnée"}
          to="/presences"
        />
        <ParentMetric
          label="Moyenne"
          value={gradeKpis.average == null ? "—" : `${gradeKpis.average.toFixed(1)}/20`}
          detail={`${gradeKpis.evaluationCount} note(s)`}
          to="/notes"
        />
        <ParentMetric
          label="Frais restants"
          value={selectedFees.length ? formatFinanceAmount(remaining, currency || undefined) : "—"}
          detail={selectedFees.length ? `${formatFinanceAmount(paid, currency || undefined)} payé` : "Aucune obligation"}
          to="/finances"
        />
        <ParentMetric
          label="Messages"
          value={String(unreadMessages)}
          detail="non lu(s)"
          to="/messages"
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-black text-ink">Accès rapides</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <ParentAction to="/mon-profil" label="Mon profil" />
            <ParentAction to="/notes" label="Notes & évaluations" />
            <ParentAction to="/presences" label="Présences" />
            <ParentAction to="/finances" label="Frais & paiements" />
            <ParentAction to="/bulletins" label="Bulletins" />
            <ParentAction to="/messages" label="Messages" />
          </div>
        </Card>

        <Card className="p-5">
          <h2 className="font-black text-ink">Dernière annonce</h2>
          {latestAnnouncement ? (
            <>
              <p className="mt-3 font-bold text-ink">{String(latestAnnouncement.title ?? "Annonce")}</p>
              <p className="mt-1 line-clamp-3 text-sm text-muted">
                {String(latestAnnouncement.message ?? latestAnnouncement.content ?? "")}
              </p>
              <Link className="mt-3 inline-flex text-sm font-black text-brand" to="/annonces">
                Voir les annonces
              </Link>
            </>
          ) : (
            <p className="mt-3 text-sm text-muted">Aucune annonce disponible.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function ParentMetric({
  label,
  value,
  detail,
  to,
}: {
  label: string;
  value: string;
  detail: string;
  to: string;
}) {
  return (
    <Link to={to} className="block">
      <Card className="h-full p-5 transition hover:border-brand">
        <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-2 text-2xl font-black text-ink">{value}</p>
        <p className="mt-1 text-sm font-semibold text-muted">{detail}</p>
      </Card>
    </Link>
  );
}

function ParentAction({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="rounded-xl border border-line bg-white px-3 py-3 text-sm font-black text-ink transition hover:border-brand hover:text-brand"
    >
      {label}
    </Link>
  );
}
