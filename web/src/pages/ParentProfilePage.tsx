import { useEffect, useMemo } from "react";
import { Card, SectionHeader } from "../components/ui/Card";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { parentLinkedStudents } from "../lib/parentNotes";

function display(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || "—";
}

function fullName(user: Record<string, any>) {
  const explicit = String(user.name ?? "").trim();
  if (explicit) return explicit;
  const composed = [user.firstName, user.lastName]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
  return composed || "Parent";
}

export function ParentProfilePage() {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();
  const user = (session?.user ?? {}) as Record<string, any>;
  const schoolCode = String(user.schoolCode ?? session?.school?.code ?? "").trim();
  const children = useMemo(() => parentLinkedStudents(user, state), [user, state]);
  const schoolName = display(session?.school?.name ?? user.schoolName ?? user.schoolCode);

  useEffect(() => {
    void ensureDomains(["students"], schoolCode ? { schoolCode } : undefined).catch(() => undefined);
  }, [ensureDomains, schoolCode]);

  return (
    <div className="space-y-6" data-testid="parent-profile-page">
      <SectionHeader
        title="Mon profil"
        description="Votre compte parent, votre établissement et les enfants officiellement liés."
      />

      <Card className="p-5">
        <p className="text-xs font-black uppercase tracking-wide text-brand">Compte parent</p>
        <h2 className="mt-1 text-xl font-black text-ink">{fullName(user)}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <ProfileField label="Prénom" value={display(user.firstName)} />
          <ProfileField label="Nom" value={display(user.lastName)} />
          <ProfileField label="Téléphone" value={display(user.phone ?? user.telephone)} />
          <ProfileField label="E-mail" value={display(user.email)} />
          <ProfileField label="Identifiant" value={display(user.identifier ?? user.publicId ?? user.id)} />
          <ProfileField label="Établissement" value={schoolName} />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="font-black text-ink">Mes enfants liés</h2>
        {children.length ? (
          <div className="mt-4 divide-y divide-line">
            {children.map((child: Record<string, unknown>, index: number) => {
              const childName =
                display(child.name) !== "—"
                  ? display(child.name)
                  : [child.firstName, child.lastName]
                      .map((value) => String(value ?? "").trim())
                      .filter(Boolean)
                      .join(" ") || "Élève";
              const meta = [
                display(child.className),
                display(child.studentCode ?? child.matricule ?? child.publicId),
              ]
                .filter((value) => value !== "—")
                .join(" • ");
              return (
                <div key={String(child.id ?? child.studentId ?? index)} className="py-3">
                  <p className="font-black text-ink">{childName}</p>
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
        <h2 className="font-black text-blue-950">Compte responsable</h2>
        <p className="mt-2 text-sm font-semibold text-blue-900">
          Ce profil représente le parent ou responsable. Les fiches des élèves restent séparées. Pour corriger vos
          coordonnées ou un lien parent-enfant, contactez l'établissement.
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
