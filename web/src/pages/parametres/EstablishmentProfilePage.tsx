import { useEffect, useState, type FormEvent } from "react";
import { useData } from "../../context/DataContext";
import { useActiveSchool } from "../../context/ActiveSchoolContext";
import { canManageEstablishmentSettings } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";
import { SCHOOL_TYPES, validateSchoolForm } from "../../lib/schoolModule";
import { establishmentsApi } from "../../lib/establishmentsApi";
import {
  Button,
  Card,
  EmptyState,
  FormField,
  FormLayout,
  InlineAlert,
  Input,
  SectionHeader,
  Select,
} from "../../design-system";
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

/**
 * Profil établissement — identité, contacts et responsable légal.
 *
 * D2.3 : migration UI vers FormLayout + primitives `@/design-system`.
 * Logique métier / API / permissions inchangées.
 *
 * Patterns : page Formulaire (D1.3) · Layout FormLayout
 * Toast : encore `components/ui` (overlay DS non livré).
 */
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
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader
            title="Profil établissement"
            description="Identité de l'établissement : logo, adresse, contacts, type, code et responsable légal."
          />
        </FormLayout.Header>
        <FormLayout.Content>
          <EmptyState
            title="Aucun établissement actif"
            description="Sélectionnez un établissement pour modifier son profil."
          />
        </FormLayout.Content>
      </FormLayout>
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
    <form onSubmit={(event) => void handleSubmit(event)}>
      <FormLayout>
        <FormLayout.Header>
          <SectionHeader
            title="Profil établissement"
            description="Identité de l'établissement : logo, adresse, contacts, type, code et responsable légal."
          />
        </FormLayout.Header>

        {!canEdit ? (
          <FormLayout.Alerts>
            <InlineAlert tone="warning" title="Lecture seule">
              Vous disposez d&apos;un accès en lecture seule. Seul l&apos;Admin School peut modifier le profil.
            </InlineAlert>
          </FormLayout.Alerts>
        ) : null}

        <FormLayout.Content>
          <Card className="space-y-8 p-6">
            <section className="space-y-4" aria-labelledby="profile-identity">
              <h3 id="profile-identity" className="text-xs font-black uppercase tracking-wide text-brand">
                Identité
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nom de l'établissement" htmlFor="profile-name" required>
                  <Input
                    id="profile-name"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    required
                    disabled={!canEdit || busy}
                  />
                </FormField>
                <FormField label="Type" htmlFor="profile-type" required>
                  <Select
                    id="profile-type"
                    value={draft.type ?? "Collège"}
                    onChange={(e) => setDraft({ ...draft, type: e.target.value })}
                    options={typeOptions}
                    disabled={!canEdit || busy}
                  />
                </FormField>
                <FormField
                  label="Code établissement"
                  htmlFor="profile-code"
                  hint="Identifiant unique, non modifiable."
                >
                  <Input
                    id="profile-code"
                    value={draft.code}
                    readOnly
                    disabled
                    className="bg-slate-50 font-mono text-xs"
                  />
                </FormField>
                <FormField
                  label="Logo (URL)"
                  htmlFor="profile-logo"
                  hint="URL publique du logo de l'établissement."
                >
                  <Input
                    id="profile-logo"
                    type="url"
                    value={draft.logoUrl ?? ""}
                    onChange={(e) => setDraft({ ...draft, logoUrl: e.target.value })}
                    placeholder="https://…"
                    disabled={!canEdit || busy}
                  />
                </FormField>
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

            <section className="space-y-4" aria-labelledby="profile-location">
              <h3 id="profile-location" className="text-xs font-black uppercase tracking-wide text-brand">
                Localisation
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Ville" htmlFor="profile-city">
                  <Input id="profile-city" value={draft.city ?? "—"} readOnly disabled className="bg-slate-50" />
                </FormField>
                <FormField label="Pays" htmlFor="profile-country">
                  <Input
                    id="profile-country"
                    value={draft.country ?? "—"}
                    readOnly
                    disabled
                    className="bg-slate-50"
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Adresse" htmlFor="profile-address">
                    <Input
                      id="profile-address"
                      value={draft.address ?? ""}
                      onChange={(e) => setDraft({ ...draft, address: e.target.value })}
                      disabled={!canEdit || busy}
                    />
                  </FormField>
                </div>
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="profile-contacts">
              <h3 id="profile-contacts" className="text-xs font-black uppercase tracking-wide text-brand">
                Contacts
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Téléphone" htmlFor="profile-phone" required>
                  <Input
                    id="profile-phone"
                    value={draft.phone ?? ""}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                    required
                    disabled={!canEdit || busy}
                  />
                </FormField>
                <FormField label="Email" htmlFor="profile-email" required>
                  <Input
                    id="profile-email"
                    type="email"
                    value={draft.email ?? ""}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                    required
                    disabled={!canEdit || busy}
                  />
                </FormField>
              </div>
            </section>

            <section className="space-y-4" aria-labelledby="profile-principal">
              <h3 id="profile-principal" className="text-xs font-black uppercase tracking-wide text-brand">
                Responsable légal
              </h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Nom du responsable" htmlFor="profile-principal-name" required>
                  <Input
                    id="profile-principal-name"
                    value={draft.principalName ?? ""}
                    onChange={(e) => setDraft({ ...draft, principalName: e.target.value })}
                    required
                    disabled={!canEdit || busy}
                  />
                </FormField>
                <FormField label="Téléphone du responsable" htmlFor="profile-principal-phone">
                  <Input
                    id="profile-principal-phone"
                    value={draft.principalPhone ?? ""}
                    onChange={(e) => setDraft({ ...draft, principalPhone: e.target.value })}
                    disabled={!canEdit || busy}
                  />
                </FormField>
                <div className="sm:col-span-2">
                  <FormField label="Email du responsable" htmlFor="profile-principal-email">
                    <Input
                      id="profile-principal-email"
                      type="email"
                      value={draft.principalEmail ?? ""}
                      onChange={(e) => setDraft({ ...draft, principalEmail: e.target.value })}
                      placeholder={draft.email || "identique à l'email établissement si vide"}
                      disabled={!canEdit || busy}
                    />
                  </FormField>
                </div>
              </div>
            </section>
          </Card>
        </FormLayout.Content>

        {canEdit ? (
          <FormLayout.StickyActions>
            <div className="flex justify-end">
              <Button type="submit" disabled={busy}>
                {busy ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </FormLayout.StickyActions>
        ) : null}
      </FormLayout>
    </form>
  );
}
