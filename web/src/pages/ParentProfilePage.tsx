import { Card, SectionHeader } from "../components/ui/Card";
import { useAuth } from "../context/AuthContext";

function value(input: unknown) {
  const text = String(input ?? "").trim();
  return text || "—";
}

export function ParentProfilePage() {
  const { session } = useAuth();
  const user = (session?.user ?? {}) as Record<string, any>;
  const children = Array.isArray(user.children) ? user.children : [];
  const fullName =
    value(user.name) !== "—"
      ? value(user.name)
      : [value(user.firstName), value(user.lastName)].filter((item) => item !== "—").join(" ") || "Parent";

  return (
    <div className="space-y-6" data-testid="parent-profile-page">
      <SectionHeader
        title="Mon profil"
        description="Votre compte parent et les enfants officiellement liés."
      />

      <Card className="p-5">
        <p className="text-xs font-black uppercase tracking-wide text-brand">Compte parent</p>
        <h2 className="mt-1 text-xl font-black text-ink">{fullName}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <ProfileField label="Prénom" value={value(user.firstName)} />
          <ProfileField label="Nom" value={value(user.lastName)} />
          <ProfileField label="Téléphone" value={value(user.phone ?? user.telephone)} />
          <ProfileField label="E-mail" value={value(user.email)} />
          <ProfileField label="Identifiant" value={value(user.identifier ?? user.publicId ?? user.id)} />
          <ProfileField
            label="Établissement"
            value={value(session?.school?.name ?? user.schoolName ?? user.schoolCode)}
          />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-black text-ink">Mes enfants liés</h2>
        {children.length ? (
          <div className="mt-4 divide-y divide-line">
            {children.map((child: Record<string, unknown>, index: number) => {
              const name =
                value(child.name) !== "—"
                  ? value(child.name)
                  : [value(child.firstName), value(child.lastName)]
                      .filter((item) => item !== "—")
                      .join(" ") || "Élève";
              const meta = [
                value(child.className),
                value(child.studentCode ?? child.matricule ?? child.publicId),
              ]
                .filter((item) => item !== "—")
                .join(" • ");
              return (
                <div key={String(child.id ?? child.studentId ?? index)} className="py-3">
                  <p className="font-black text-ink">{name}</p>
                  <p className="mt-1 text-sm font-semibold text-muted">{meta || "Élève lié"}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-3 text-sm font-semibold text-muted">Aucun enfant lié à ce compte.</p>
        )}
      </Card>

      <Card className="border-blue-200 bg-blue-50 p-5">
        <h2 className="font-black text-blue-950">Sécurité et coordonnées</h2>
        <p className="mt-2 text-sm font-semibold text-blue-900">
          Votre compte utilise un mot de passe Somafrik. Les préférences de communication sont accessibles depuis
          l'icône de profil en haut de l'application. Pour corriger une identité ou un lien parent-enfant, contactez
          l'établissement.
        </p>
      </Card>
    </div>
  );
}

function ProfileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-black uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 font-bold text-ink">{value}</p>
    </div>
  );
}
