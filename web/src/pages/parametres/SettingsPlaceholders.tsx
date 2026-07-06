import { BellRing, Building2, DatabaseBackup, Palette, PlugZap, Wallet } from "lucide-react";
import { PagePlaceholder } from "../../components/ui/PagePlaceholder";
import { useData } from "../../context/DataContext";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Table, type Column } from "../../components/ui/Table";
import { PrintButton } from "../../components/ui/PrintButton";
import type { AuditEntry } from "../../lib/audit";

export function SettingsProfilePage() {
  return (
    <PagePlaceholder
      icon={Building2}
      title="Profil établissement"
      description="Identité de l'établissement : logo, adresse, contacts, type, code établissement et responsable légal."
    />
  );
}

export function SettingsFinancePage() {
  return (
    <PagePlaceholder
      icon={Wallet}
      title="Paramètres Finances"
      description="Configuration des règles financières : types de frais (inscription, mensualités, examen), échéances, moyens de paiement, devises, pénalités et réductions. Les opérations restent dans le module Finances."
    />
  );
}

export function SettingsNotificationsPage() {
  return (
    <PagePlaceholder
      icon={BellRing}
      title="Paramètres Notifications"
      description="Canaux de communication (push, e-mail, SMS, WhatsApp), modèles de messages et déclencheurs automatiques (note publiée, absence, impayé)."
    />
  );
}

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

function formatAuditDate(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString("fr-FR");
}

export function SettingsSecurityPage() {
  const { state } = useData();
  const entries = (Array.isArray(state.auditLog) ? state.auditLog : []) as AuditEntry[];

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
    {
      key: "action",
      header: "Action",
      render: (row) => AUDIT_ACTION_LABELS[row.action] ?? row.action,
    },
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

  return (
    <Card className="p-6">
      <SectionHeader
        title="Journal d'audit"
        description={`${entries.length} action(s) enregistrée(s) sur les contacts, relations et accès.`}
        actions={<PrintButton documentTitle="Journal d'audit — Somafrik" />}
      />
      <div className="mt-4">
        {entries.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line bg-slate-50 p-6 text-center text-sm text-muted">
            Aucune action enregistrée pour le moment. Les créations, modifications et suppressions de
            contacts, relations et rôles apparaîtront ici.
          </p>
        ) : (
          <Table columns={columns} rows={entries} rowKey={(row) => row.id} />
        )}
      </div>
    </Card>
  );
}

export function SettingsAppearancePage() {
  return (
    <PagePlaceholder
      icon={Palette}
      title="Apparence"
      description="Personnalisation visuelle de l'établissement (MVP : logo, couleur principale et nom affiché)."
    />
  );
}

export function SettingsIntegrationsPage() {
  return (
    <PagePlaceholder
      icon={PlugZap}
      title="Intégrations"
      description="Connexions externes : mobile money (Orange, MTN, Airtel), SMS, WhatsApp API, SMTP, stockage cloud, NFC et webhooks."
    />
  );
}

export function SettingsDataPage() {
  return (
    <PagePlaceholder
      icon={DatabaseBackup}
      title="Données et sauvegarde"
      description="Import d'élèves et d'enseignants, export Excel, sauvegarde, restauration, archivage et suppression des données."
    />
  );
}
