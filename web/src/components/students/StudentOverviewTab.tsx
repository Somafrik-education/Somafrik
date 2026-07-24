import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { buildStudentWorkspacePath } from "../../lib/studentWorkspaceNavigation";
import { StudentWorkspaceAlert } from "./StudentWorkspaceAlert";
import { StudentWorkspaceMetric } from "./StudentWorkspaceMetric";

interface StudentOverviewTabProps {
  workspace: StudentWorkspaceViewModel;
}

export function StudentOverviewTab({ workspace }: StudentOverviewTabProps) {
  return (
    <div className="space-y-6">
      {workspace.alerts.length > 0 ? (
        <section aria-label="Alertes du dossier" className="space-y-3">
          {workspace.alerts.map((alert) => (
            <StudentWorkspaceAlert
              key={alert.id}
              alert={alert}
              studentId={workspace.studentId}
            />
          ))}
        </section>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
        <StudentWorkspaceMetric
          title="Identité"
          description="Informations personnelles essentielles."
          href={buildStudentWorkspacePath(workspace.studentId, "identity")}
          linkLabel="Ouvrir Identité"
          items={[
            { label: "Sexe", value: workspace.genderLabel },
            { label: "Âge", value: workspace.ageLabel },
            { label: "Date de naissance", value: workspace.birthDateLabel },
            { label: "Téléphone", value: workspace.phoneLabel },
            { label: "Nationalité", value: workspace.nationalityLabel },
          ]}
        />

        <StudentWorkspaceMetric
          title="Scolarité actuelle"
          description="Situation d'inscription de l'élève."
          href={buildStudentWorkspacePath(workspace.studentId, "enrollments")}
          linkLabel="Ouvrir Inscription"
          items={[
            { label: "Année scolaire", value: workspace.academicYearLabel },
            { label: "Classe", value: workspace.classLabel },
            {
              label: "Statut d'inscription",
              value: workspace.enrollmentStatusLabel,
            },
            { label: "Date d'entrée", value: workspace.enrollmentDateLabel },
          ]}
        />

        <StudentWorkspaceMetric
          title="Responsables"
          description="Contacts familiaux liés au dossier."
          href={buildStudentWorkspacePath(workspace.studentId, "guardians")}
          linkLabel="Ouvrir Responsables"
          items={[
            {
              label: "Nombre de responsables",
              value: workspace.guardiansCountLabel,
            },
            {
              label: "Responsable principal",
              value: workspace.primaryGuardianNameLabel,
            },
            {
              label: "Téléphone principal",
              value: workspace.primaryGuardianPhoneLabel,
            },
          ]}
        />

        <StudentWorkspaceMetric
          title="État du dossier"
          description="Points d'attention calculés automatiquement."
          href={buildStudentWorkspacePath(workspace.studentId, "overview")}
          linkLabel="Rester sur la vue d'ensemble"
          items={[
            {
              label: "Alertes",
              value:
                workspace.alerts.length > 0
                  ? `${workspace.alerts.length} point${workspace.alerts.length > 1 ? "s" : ""} d'attention`
                  : "Aucun point d'attention",
            },
            {
              label: "Documents",
              value: workspace.hasDocuments
                ? `Conformité ${workspace.documentsModule.complianceLabel}`
                : "Aucun document",
            },
            {
              label: "Profil médical",
              value: workspace.medical.hasCriticalRisk
                ? "Risque critique signalé"
                : workspace.hasMedicalProfile
                  ? "Profil médical disponible"
                  : "Aucun profil médical",
            },
            {
              label: "Historique",
              value: workspace.historyModule.latestImportantEventLabel
                ? workspace.historyModule.latestImportantEventLabel
                : workspace.historyModule.summary.totalEvents > 0
                  ? `${workspace.historyModule.summary.totalEvents} événement${workspace.historyModule.summary.totalEvents > 1 ? "s" : ""}`
                  : "Aucun événement",
            },
          ]}
        />
      </div>
    </div>
  );
}
