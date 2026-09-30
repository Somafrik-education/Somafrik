import { useStudentEditingContext } from "../../hooks/useStudentEditingContext";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import type { SchoolStudent } from "../../lib/studentsApi";
import { Card, SectionHeader } from "../../design-system";
import { StudentEditingPanel } from "./editing/StudentEditingPanel";

interface StudentIdentityTabProps {
  workspace: StudentWorkspaceViewModel;
  dossier?: SchoolStudent | null;
  onIdentityPersisted?: () => void | Promise<void>;
}

interface IdentityFieldProps {
  label: string;
  value: string;
}

function IdentityField({ label, value }: IdentityFieldProps) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
        {label}
      </dt>

      <dd className="mt-1 break-words text-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}

export function StudentIdentityTab({
  workspace,
  dossier = null,
  onIdentityPersisted,
}: StudentIdentityTabProps) {
  const editing = useStudentEditingContext(workspace.studentId, {
    dossier,
    onIdentityPersisted,
  });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <SectionHeader
          title="Identité de l’élève"
          description="Informations personnelles et coordonnées."
        />

        <dl className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <IdentityField label="Sexe" value={workspace.genderLabel} />
          <IdentityField
            label="Date de naissance"
            value={workspace.birthDateLabel}
          />
          <IdentityField
            label="Lieu de naissance"
            value={workspace.birthPlaceLabel}
          />
          <IdentityField
            label="Nationalité"
            value={workspace.nationalityLabel}
          />
          <IdentityField label="Téléphone" value={workspace.phoneLabel} />
          <IdentityField
            label="Adresse e-mail"
            value={workspace.emailLabel}
          />
          <div className="sm:col-span-2 xl:col-span-3">
            <IdentityField label="Adresse" value={workspace.addressLabel} />
          </div>
        </dl>
      </Card>

      <Card className="p-6">
        <SectionHeader
          title="Édition contrôlée"
          description="Les champs persistés (prénom, nom, sexe, naissance, lieu, téléphone, e-mail) sont enregistrés en PostgreSQL. Nationalité, adresse et nom d'usage restent hors contrat PATCH."
        />
        <div className="mt-6">
          <StudentEditingPanel
            canUpdateIdentity={editing.canUpdateIdentity}
            canUpdateGuardians={false}
            canUpdateAdministrative={editing.canUpdateAdministrative}
            identity={editing.identity}
            guardians={[]}
            administrative={editing.administrative}
            authContext={editing.authContext}
            repository={editing.repository}
            onSuccess={editing.refreshFromStore}
          />
        </div>
      </Card>
    </div>
  );
}
