import { useEffect, useState, type FormEvent } from "react";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { canManageEstablishmentSettings } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { SCHOOL_TYPES, validateSchoolForm } from "../../lib/schoolModule";
import { establishmentsApi } from "../../lib/establishmentsApi";
import { Card, SectionHeader } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Field, Input, Select } from "../../components/ui/Field";
import { useToast } from "../../components/ui/Toast";
import type { School } from "../../types";

function schoolToDraft(school: School): School {
  return {
    ...school,
    name: school.name ?? "",
    type: school.type ?? "Collège",
    address: school.address ?? "",
    phone: school.phone ?? "",
    email: school.email ?? "",
    logoUrl: school.logoUrl ?? "",
    principalName: school.principalName ?? "",
    principalEmail: school.principalEmail ?? "",
    principalPhone: school.principalPhone ?? "",
  };
}

/** Profil établissement — identité, contacts et responsable légal. */
export function EstablishmentProfilePage() {
  const { state, refresh } = useData();
  const { activeSchool } = useActiveSchool();
  const ctx = usePermissionContext();
  const { showToast } = useToast();
  const canEdit = canManageEstablishmentSettings(ctx);

  const [draft, setDraft] = useState<School | null>(() => (activeSchool ? schoolToDraft(activeSchool) : null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setDraft(activeSchool ? schoolToDraft(activeSchool) : null);
  }, [activeSchool?.code, activeSchool?.updatedAt]);

  if (!activeSchool || !draft) {
    return (
      <Card className="p-6">
        <SectionHeader
          title="Profil établissement"
          description="Identité de l'établissement : logo, adresse, contacts, type, code et responsable légal."
        />
        <p className="mt-4 rounded-xl border border-dashed border-line bg-slate-50 p-6 text-center text-sm text-muted">
          Aucun établissement actif. Sélectionnez un établissement pour modifier son profil.
        </p>
      </Card>
    );
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!canEdit || !draft) return;
    const current = draft;
    if (!current.code) return;

    const validationError = validateSchoolForm(current, state.schools, { isNew: false });
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    const patch: Partial<School> = {
      name: current.name.trim(),
      type: current.type,
      address: current.address?.trim() ?? "",
      phone: current.phone?.trim() ?? "",
      email: current.email?.trim() ?? "",
      logoUrl: current.logoUrl?.trim() ?? "",
      principalName: current.principalName?.trim() ?? "",
      principalEmail: current.principalEmail?.trim() || current.email?.trim() || "",
      principalPhone: current.principalPhone?.trim() ?? "",
    };

    setBusy(true);
    try {
      await establishmentsApi.update(current.code, patch);
      await refresh();
      showToast("Profil établissement enregistré", "success");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Échec de l'enregistrement";
      showToast(message, "error");
    } finally {
      setBusy(false);
    }
  }

  const typeOptions = [...new Set([...SCHOOL_TYPES, draft.type].filter((value): value is string => Boolean(value)))].map(
    (value) => ({
      value,
      label: value,
    }),
  );

  return (
    <Card className="p-6">
      <SectionHeader
        title="Profil établissement"
        description="Identité de l'établissement : logo, adresse, contacts, type, code et responsable légal."
      />

      {!canEdit ? (
        <p className="mt-4 rounded-xl border border-amber/30 bg-amber/10 px-4 py-3 text-sm text-ink">
          Vous disposez d&apos;un accès en lecture seule. Seul l&apos;Admin School peut modifier le profil.
        </p>
      ) : null}

      <form className="mt-6 space-y-8" onSubmit={(event) => void handleSubmit(event)}>
        <section className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wide text-brand">Identité</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom de l'établissement" required>
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                required
                disabled={!canEdit || busy}
              />
            </Field>
            <Field label="Type" required>
              <Select
                value={draft.type ?? "Collège"}
                onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                options={typeOptions}
                disabled={!canEdit || busy}
              />
            </Field>
            <Field label="Code établissement" hint="Identifiant unique, non modifiable.">
              <Input value={draft.code} readOnly disabled className="bg-slate-50 font-mono text-xs" />
            </Field>
            <Field label="Logo (URL)" hint="URL publique du logo de l'établissement.">
              <Input
                type="url"
                value={draft.logoUrl ?? ""}
                onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
                placeholder="https://…"
                disabled={!canEdit || busy}
              />
            </Field>
            {draft.logoUrl ? (
              <div className="sm:col-span-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Aperçu du logo</p>
                <img
                  src={draft.logoUrl}
                  alt=""
                  className="h-16 w-auto rounded border border-line bg-white object-contain p-1"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wide text-brand">Localisation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Ville">
              <Input value={draft.city ?? "—"} readOnly disabled className="bg-slate-50" />
            </Field>
            <Field label="Pays">
              <Input value={draft.country ?? "—"} readOnly disabled className="bg-slate-50" />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Adresse">
                <Input
                  value={draft.address ?? ""}
                  onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                  disabled={!canEdit || busy}
                />
              </Field>
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wide text-brand">Contacts</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Téléphone" required>
              <Input
                value={draft.phone ?? ""}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                required
                disabled={!canEdit || busy}
              />
            </Field>
            <Field label="Email" required>
              <Input
                type="email"
                value={draft.email ?? ""}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                required
                disabled={!canEdit || busy}
              />
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <h2 className="text-xs font-black uppercase tracking-wide text-brand">Responsable légal</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nom du responsable" required>
              <Input
                value={draft.principalName ?? ""}
                onChange={(e) => setDraft({ ...draft, principalName: e.target.value })}
                required
                disabled={!canEdit || busy}
              />
            </Field>
            <Field label="Téléphone du responsable">
              <Input
                value={draft.principalPhone ?? ""}
                onChange={(e) => setDraft({ ...draft, principalPhone: e.target.value })}
                disabled={!canEdit || busy}
              />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Email du responsable">
                <Input
                  type="email"
                  value={draft.principalEmail ?? ""}
                  onChange={(e) => setDraft({ ...draft, principalEmail: e.target.value })}
                  placeholder={draft.email || "identique à l'email établissement si vide"}
                  disabled={!canEdit || busy}
                />
              </Field>
            </div>
          </div>
        </section>

        {canEdit ? (
          <div className="flex justify-end border-t border-line pt-4">
            <Button type="submit" disabled={busy}>
              {busy ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        ) : null}
      </form>
    </Card>
  );
}
