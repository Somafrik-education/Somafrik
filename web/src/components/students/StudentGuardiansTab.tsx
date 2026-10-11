import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Card, SectionHeader, EmptyState } from "../../design-system";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { activeLinkedParents, type LinkedParent } from "../../lib/studentParentRelations";
import { parentsApi } from "../../lib/parentsApi";
import { canLinkParent } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

interface StudentGuardiansTabProps {
  workspace: StudentWorkspaceViewModel;
}

type LinkForm = { firstName: string; lastName: string; phone: string; email: string };
const EMPTY_FORM: LinkForm = { firstName: "", lastName: "", phone: "", email: "" };

function errorLabel(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message
    : "Impossible de lire ou de modifier les liaisons parent-élève.";
}

/**
 * Responsables Web : les relations PostgreSQL sont l'unique source d'autorité.
 * Pas de faux contact parent hérité, pas d'édition mock, pas de catégories
 * autonomes responsable financier / récupération / urgence.
 */
export function StudentGuardiansTab({ workspace }: StudentGuardiansTabProps) {
  const permissionCtx = usePermissionContext();
  const canLink = canLinkParent(permissionCtx);
  const [reload, setReload] = useState(0);
  const [relations, setRelations] = useState<LinkedParent[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [form, setForm] = useState<LinkForm>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [access, setAccess] = useState<{ identifier: string; password: string } | null>(null);

  useEffect(() => {
    let current = true;
    setLoading(true);
    setLoadError(null);
    setRelations([]);
    void parentsApi.listRelations(workspace.studentId)
      .then((response) => {
        if (!current) return;
        if (!Array.isArray(response.items)) {
          throw new Error("Réponse des responsables invalide.");
        }
        setRelations(activeLinkedParents(response.items));
      })
      .catch((error: unknown) => {
        if (current) setLoadError(errorLabel(error));
      })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspace.studentId, reload]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canLink || submitting) return;
    setActionError(null);
    setConfirmation(null);
    setAccess(null);
    const phone = form.phone.trim();
    const email = form.email.trim();
    if (!phone && !email) {
      setActionError("Renseignez un téléphone ou un e-mail pour identifier le parent.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await parentsApi.linkParent({
        studentId: workspace.studentId,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone,
        email,
      });
      if (result.createdUser) {
        const user = result.user;
        const identifier = String(user?.identifier || user?.userCode || user?.loginCode || "").trim();
        const password = String(result.temporaryPassword || "").trim();
        if (!identifier || !password) {
          setConfirmation("Compte parent créé, mais identifiants indisponibles : demandez une réinitialisation sécurisée.");
        } else {
          setAccess({ identifier, password });
          setConfirmation("Compte parent créé et lié à l'élève. Remettez les accès directement au parent.");
        }
      } else {
        setConfirmation(result.created === false
          ? "Cette relation existe déjà. Aucun nouveau compte créé."
          : "Compte parent existant réutilisé et lié à cet élève.");
      }
      setForm(EMPTY_FORM);
      setReload((value) => value + 1);
    } catch (error) {
      setActionError(errorLabel(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6" data-testid="student-guardians-tab">
      <Card className="p-6">
        <SectionHeader
          title="Parents et tuteurs liés"
          description="Uniquement les personnes réellement associées à cet élève dans l'établissement."
        />
        {loading ? (
          <p className="mt-5 text-sm text-muted">Chargement des parents liés…</p>
        ) : loadError ? (
          <div className="mt-5" role="alert">
            <p className="text-sm font-semibold text-danger">{loadError}</p>
            <button type="button" className="mt-3 rounded-lg border border-line px-4 py-2 text-sm"
              onClick={() => setReload((value) => value + 1)}>Réessayer</button>
          </div>
        ) : relations.length === 0 ? (
          <EmptyState className="mt-6" title="Aucun parent ou tuteur lié" />
        ) : (
          <ul className="mt-6 space-y-3">
            {relations.map((person) => (
              <li key={person.id} className="rounded-xl border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-ink">{person.name}</strong>
                  {person.isPrincipal ? <span className="text-xs font-semibold text-brand">Principal</span> : null}
                </div>
                <p className="mt-2 text-sm text-muted">
                  Téléphone : {person.phone || "Non renseigné"} · E-mail : {person.email || "Non renseigné"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canLink ? (
        <Card className="p-6">
          <SectionHeader
            title="Lier un parent"
            description="Le compte existant est réutilisé si l'identité correspond ; sinon un compte Parent est créé avec ses accès."
          />
          <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={(event) => void submit(event)}>
            <label className="text-sm font-medium text-ink">
              Prénom
              <input className="mt-1 w-full rounded-lg border border-line p-3" value={form.firstName}
                onChange={(event) => setForm((old) => ({ ...old, firstName: event.target.value }))} maxLength={120} />
            </label>
            <label className="text-sm font-medium text-ink">
              Nom
              <input className="mt-1 w-full rounded-lg border border-line p-3" value={form.lastName}
                onChange={(event) => setForm((old) => ({ ...old, lastName: event.target.value }))} maxLength={120} />
            </label>
            <label className="text-sm font-medium text-ink">
              Téléphone
              <input type="tel" className="mt-1 w-full rounded-lg border border-line p-3" value={form.phone}
                onChange={(event) => setForm((old) => ({ ...old, phone: event.target.value }))} />
            </label>
            <label className="text-sm font-medium text-ink">
              E-mail
              <input type="email" className="mt-1 w-full rounded-lg border border-line p-3" value={form.email}
                onChange={(event) => setForm((old) => ({ ...old, email: event.target.value }))} />
            </label>
            <div className="sm:col-span-2">
              <button disabled={submitting} type="submit"
                className="rounded-lg bg-brand px-5 py-3 font-semibold text-white disabled:opacity-50">
                {submitting ? "Liaison en cours…" : "Créer ou lier le parent"}
              </button>
            </div>
          </form>
          {actionError ? <p className="mt-4 text-sm text-danger" role="alert">{actionError}</p> : null}
          {confirmation ? <p className="mt-4 text-sm font-medium text-ink" role="status">{confirmation}</p> : null}
          {access ? (
            <div className="mt-4 rounded-xl border border-line p-4" role="status">
              <p className="font-semibold text-ink">Accès provisoires — affichage unique</p>
              <p className="mt-2 text-sm text-ink">Identifiant : <strong>{access.identifier}</strong></p>
              <p className="mt-1 text-sm text-ink">Mot de passe temporaire : <strong>{access.password}</strong></p>
              <p className="mt-2 text-sm text-muted">Communiquez-les en privé au parent. Ils ne seront pas conservés sur cette page.</p>
              <button type="button" className="mt-3 rounded-lg border border-line px-4 py-2 text-sm"
                onClick={() => setAccess(null)}>J'ai remis les accès</button>
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
