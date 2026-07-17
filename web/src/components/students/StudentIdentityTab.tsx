import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { Card, SectionHeader } from "../ui/Card";

interface StudentIdentityTabProps {
  workspace: StudentWorkspaceViewModel;
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
}: StudentIdentityTabProps) {
  return (
    <Card className="p-6">
      <SectionHeader
        title="Identité de l’élève"
        description="Informations personnelles et coordonnées."
      />

      <div className="mt-6">
        <div>
          <p className="text-xl font-bold text-ink">
            {workspace.displayName}
          </p>

          <p className="mt-1 text-sm text-muted">
            Matricule : {workspace.matriculeLabel}
          </p>
        </div>

        <dl className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
          <IdentityField
            label="Sexe"
            value={workspace.genderLabel}
          />

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

          <IdentityField
            label="Téléphone"
            value={workspace.phoneLabel}
          />

          <IdentityField
            label="Adresse e-mail"
            value={workspace.emailLabel}
          />

          <div className="sm:col-span-2 xl:col-span-3">
            <IdentityField
              label="Adresse"
              value={workspace.addressLabel}
            />
          </div>
        </dl>
      </div>
    </Card>
  );
}