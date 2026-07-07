import { useMemo, useState } from "react";
import { CheckCircle2, KeyRound, ShieldCheck, UserCog } from "lucide-react";
import { useData } from "../../context/DataContext";
import { useAuth } from "../../context/AuthContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Table, type Column } from "../../components/ui/Table";
import { Field, Input, Select } from "../../components/ui/Field";
import { Button } from "../../components/ui/Button";
import { PrintButton } from "../../components/ui/PrintButton";
import { rowsToCsv, downloadCsv } from "../../lib/csv";
import type { AuditEntry } from "../../lib/audit";

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "contact.create": "Contact créé",
  "contact.update": "Contact modifié",
  "contact.delete": "Contact supprimé",
  "contact.import": "Import de contacts",
  "relation.create": "Relation créée",
  "relation.update": "Relation modifiée",
  "relation.delete": "Relation supprimée",
  "user.role.assign": "Rôle / accès attribué",
  "student.create": "Fiche élève créée (depuis contact)",
  "student.link": "Fiche élève reliée au contact",
  "teacher.create": "Fiche enseignant créée (depuis contact)",
  "teacher.link": "Fiche enseignant reliée au contact",
};

function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

function formatAuditDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

interface PolicyRuleProps {
  label: string;
}

function PolicyRule({ label }: PolicyRuleProps) {
  return (
    <li className="flex items-start gap-2 text-sm text-ink">
      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" strokeWidth={2} />
      <span>{label}</span>
    </li>
  );
}

interface InfoRowProps {
  label: string;
  value?: string;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <div className="flex flex-col">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</span>
      <span className="mt-0.5 text-sm font-medium text-ink">{value || "—"}</span>
    </div>
  );
}

/** Paramètres Sécurité — session active, politique d'accès et journal d'audit. */
export function SettingsSecurityPage() {
  const { state } = useData();
  const { session } = useAuth();
  const user = session?.user ?? null;

  const [search, setSearch] = useState("");
  const [actionFilter, setActionFilter] = useState("all");

  const entries = useMemo(
    () => (Array.isArray(state.auditLog) ? (state.auditLog as AuditEntry[]) : []),
    [state.auditLog],
  );

  const actionOptions = useMemo(() => {
    const actions = Array.from(new Set(entries.map((entry) => entry.action))).sort();
    return [
      { value: "all", label: "Toutes les actions" },
      ...actions.map((action) => ({ value: action, label: auditActionLabel(action) })),
    ];
  }, [entries]);

  const filteredEntries = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return entries.filter((entry) => {
      if (actionFilter !== "all" && entry.action !== actionFilter) return false;
      if (!needle) return true;
      const haystack = [
        entry.actorName,
        entry.actorRole,
        auditActionLabel(entry.action),
        entry.entityLabel,
        entry.entityType,
        entry.schoolCode,
        entry.details,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }, [entries, search, actionFilter]);

  const columns: Column<AuditEntry>[] = [
    { key: "at", header: "Date / heure", render: (row) => formatAuditDate(row.at) },
    {
      key: "actorName",
      header: "Auteur",
      render: (row) => (
        <div>
          <p className="font-medium text-ink">{row.actorName || "—"}</p>
          {row.actorRole ? <p className="text-xs text-muted">{row.actorRole}</p> : null}
        </div>
      ),
    },
    { key: "action", header: "Action", render: (row) => auditActionLabel(row.action) },
    {
      key: "entityLabel",
      header: "Élément",
      render: (row) => (
        <div>
          <p className="text-ink">{row.entityLabel || "—"}</p>
          {row.schoolCode ? <p className="text-xs text-muted">{row.schoolCode}</p> : null}
        </div>
      ),
    },
    { key: "details", header: "Détails", render: (row) => row.details || "—" },
  ];

  function handleExportAudit() {
    const csvColumns = [
      { key: "at", header: "Date / heure" },
      { key: "actorName", header: "Auteur" },
      { key: "actorRole", header: "Rôle" },
      { key: "action", header: "Action" },
      { key: "entityLabel", header: "Élément" },
      { key: "schoolCode", header: "Établissement" },
      { key: "details", header: "Détails" },
    ];
    const rows = filteredEntries.map((entry) => ({
      at: formatAuditDate(entry.at),
      actorName: entry.actorName ?? "",
      actorRole: entry.actorRole ?? "",
      action: auditActionLabel(entry.action),
      entityLabel: entry.entityLabel ?? "",
      schoolCode: entry.schoolCode ?? "",
      details: entry.details ?? "",
    }));
    downloadCsv(`journal-audit-${new Date().toISOString().slice(0, 10)}`, rowsToCsv(rows, csvColumns));
  }

  const displayName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ").trim() || user?.identifier || "—";

  return (
    <div className="space-y-5">
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
              <UserCog className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Session active</h2>
              <p className="text-sm text-muted">Compte actuellement connecté à la plateforme.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <InfoRow label="Utilisateur" value={displayName} />
            <InfoRow label="Identifiant" value={user?.identifier} />
            <InfoRow label="Rôle" value={user?.role} />
            <InfoRow label="Canal d'accès" value={user?.accessChannel} />
            <InfoRow label="Établissement" value={user?.schoolCode} />
            <InfoRow label="Portée" value={session?.scope?.label} />
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand">
              <KeyRound className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <div>
              <h2 className="text-lg font-bold text-ink">Politique de mot de passe & PIN</h2>
              <p className="text-sm text-muted">Règles appliquées à la création et au changement.</p>
            </div>
          </div>
          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-brand">
                <ShieldCheck className="h-4 w-4" /> Mot de passe
              </p>
              <ul className="space-y-1.5">
                <PolicyRule label="Au moins 8 caractères" />
                <PolicyRule label="Au moins une lettre" />
                <PolicyRule label="Au moins un chiffre" />
                <PolicyRule label="Changement obligatoire à la première connexion" />
              </ul>
            </div>
            <div>
              <p className="mb-2 flex items-center gap-1.5 text-xs font-black uppercase tracking-wide text-brand">
                <ShieldCheck className="h-4 w-4" /> Code PIN (mobile)
              </p>
              <ul className="space-y-1.5">
                <PolicyRule label="Exactement 6 chiffres" />
                <PolicyRule label="Utilisé pour l'accès rapide sur mobile" />
              </ul>
            </div>
          </div>
        </Card>
      </div>

      <Card className="p-6">
        <SectionHeader
          title="Journal d'audit"
          description={`${filteredEntries.length} action(s) affichée(s) sur ${entries.length} enregistrée(s).`}
          actions={
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={handleExportAudit}
                disabled={filteredEntries.length === 0}
              >
                Exporter CSV
              </Button>
              <PrintButton documentTitle="Journal d'audit — Somafrik" />
            </>
          }
        />
        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_240px]">
          <Field label="Recherche">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Auteur, élément, détails…"
            />
          </Field>
          <Field label="Type d'action">
            <Select
              value={actionFilter}
              onChange={(event) => setActionFilter(event.target.value)}
              options={actionOptions}
            />
          </Field>
        </div>
        <div className="mt-4">
          {filteredEntries.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line bg-slate-50 p-6 text-center text-sm text-muted">
              {entries.length === 0
                ? "Aucune action enregistrée pour le moment. Les créations, modifications et suppressions de contacts, relations et rôles apparaîtront ici."
                : "Aucune action ne correspond à votre recherche."}
            </p>
          ) : (
            <Table columns={columns} rows={filteredEntries} rowKey={(row) => row.id} />
          )}
        </div>
      </Card>
    </div>
  );
}
