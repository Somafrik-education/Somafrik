/**
 * D2.8d2 — Workflow Contacts & Comptes.
 *
 * Plans métier purs / quasi purs pour Contacts (pré-validation, post-merge
 * accès utilisateur, liaison fiche, import, audit, création fiche).
 * Aucun hook ni contexte React ; dépendances injectées.
 *
 * Hors lot : Relations, Paiements, Affectations (D2.8d1), JSX modales.
 */
import type { AuditEntry } from "../../lib/audit";
import { appendAuditLog, auditActor, makeAuditEntry } from "../../lib/audit";
import {
  contactHasOperationalRecord,
  linkContactToOperationalRecord,
  prepareContactForSave,
  promoteContactToUser,
  revokeContactUserAccess,
  validateContactDuplicate,
  type ContactLinkResult,
  type ContactPromotionResult,
} from "../../lib/contacts";
import { findUserAccountForContact } from "../../lib/userAccounts";
import {
  parseTeacherProvisioningSelection,
  syncSingleUserToTeachers,
} from "../../lib/userTeacherSync";
import { normalize } from "../../lib/format";
import type { BackOfficeState, SessionUser, UserAccount } from "../../types";
import { newEntityId } from "./entityCrudCore";

export type EntityRow = Record<string, unknown>;

export type ToastFn = (
  message: string,
  tone?: "info" | "success" | "error" | "warning",
) => void;

export type ContactAccountWorkflowDeps = {
  scopeUser: SessionUser | null;
  state: BackOfficeState;
  showToast: ToastFn;
  /**
   * Injecté pour tests / découplage (défaut possible côté EntityPage :
   * syncSingleUserToTeachers du lib).
   */
  syncSingleUserToTeachers: typeof syncSingleUserToTeachers;
};

export function contactDisplayLabel(row: EntityRow): string {
  return `${String(row.lastName ?? "")} ${String(row.firstName ?? "")}`.trim();
}

export function defaultNewContactDraft(schoolCode: string | undefined): EntityRow {
  return {
    status: "Actif",
    schoolCode: schoolCode && schoolCode !== "*" ? schoolCode : "",
  };
}

export type ContactPreSubmitPlan =
  | { ok: false }
  | { ok: true; workingItem: EntityRow; duplicateWarn?: string };

/**
 * Pré-validation Contacts avant merge.
 * Le `confirm` de doublon potentiel reste dans EntityPage.
 */
export function buildContactPreSubmitPlan(
  deps: Pick<ContactAccountWorkflowDeps, "state" | "showToast">,
  input: {
    workingItem: EntityRow;
    editingId?: string;
  },
): ContactPreSubmitPlan {
  const { state, showToast } = deps;
  const workingItem = prepareContactForSave(input.workingItem, state);

  if (!String(workingItem.schoolCode ?? "").trim()) {
    showToast("Le compte lié est obligatoire : un contact ne peut pas être isolé.", "error");
    return { ok: false };
  }

  const allContacts = (state.contacts ?? []) as unknown as EntityRow[];
  const duplicate = validateContactDuplicate(workingItem, allContacts, input.editingId);
  if (duplicate.block) {
    showToast(duplicate.block, "error");
    return { ok: false };
  }

  if (
    String(workingItem.hasAccess ?? "") === "Oui" &&
    !String(workingItem.role ?? "").trim()
  ) {
    showToast("Choisissez un rôle pour créer l'accès utilisateur.", "error");
    return { ok: false };
  }

  return {
    ok: true,
    workingItem,
    duplicateWarn: duplicate.warn || undefined,
  };
}

export type ContactPostMergePlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: string;
      promotion: ContactPromotionResult | null;
      ficheLink: ContactLinkResult | null;
    };

/**
 * Effets post-merge Contacts : révocation / promotion compte + liaison fiche.
 * Quirk préservé : promote utilise `state` brut ; revoke utilise state+patch.
 */
export function buildContactPostMergePlan(
  deps: ContactAccountWorkflowDeps,
  input: {
    nextContact: EntityRow;
    nextAllRows: EntityRow[];
    basePatch: Partial<BackOfficeState>;
    /** Soumission EntityPage : `schoolCode` (pas effectiveSchoolCode). */
    linkSchoolCode: string | undefined;
    defaultSuccessMessage: string;
  },
): ContactPostMergePlan {
  const { scopeUser, state, showToast, syncSingleUserToTeachers: syncTeachers } = deps;
  const { nextContact, nextAllRows, basePatch, linkSchoolCode } = input;

  const patch: Partial<BackOfficeState> = { ...basePatch };
  let successMessage = input.defaultSuccessMessage;
  let promotion: ContactPromotionResult | null = null;
  let ficheLink: ContactLinkResult | null = null;

  if (String(nextContact.hasAccess ?? "") === "Non") {
    const revoked = revokeContactUserAccess(nextContact, {
      ...state,
      ...patch,
      contacts: nextAllRows,
    } as unknown as BackOfficeState);
    patch.users = revoked.users;
    patch.contacts = (
      (patch.contacts as unknown as EntityRow[] | undefined) ?? nextAllRows
    ).map((row) =>
      String(row.id) === String(nextContact.id) ? revoked.contact : row,
    ) as unknown as BackOfficeState["contacts"];
  }

  if (String(nextContact.hasAccess ?? "") === "Oui") {
    try {
      // Quirk : promote sur state original (pas le patch mergé).
      promotion = promoteContactToUser(nextContact, state, scopeUser);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Création du compte impossible.", "error");
      return { ok: false };
    }
    patch.users = promotion.users;
    const promotedUser = promotion.users.find(
      (user) => normalize(String(user.contactId ?? "")) === normalize(String(nextContact.id ?? "")),
    );
    if (promotedUser) {
      const teacherPatch = syncTeachers({ ...state, users: promotion.users }, promotedUser);
      if (teacherPatch.teachers !== state.teachers) {
        patch.teachers = teacherPatch.teachers;
      }
    }
    const mergedContacts = (
      (patch.contacts as unknown as EntityRow[] | undefined) ?? nextAllRows
    ).map((row) =>
      String(row.id) === String(nextContact.id) ? promotion!.contact : row,
    );
    patch.contacts = mergedContacts as unknown as BackOfficeState["contacts"];
    if (promotion.created && promotion.temporaryPassword) {
      successMessage = `Contact enregistré · accès ${promotion.contact.userIdentifier} · mot de passe provisoire : ${promotion.temporaryPassword}`;
    } else {
      successMessage = `Contact enregistré · accès ${promotion.contact.userIdentifier}`;
    }
  }

  if (contactHasOperationalRecord(String(nextContact.contactType ?? ""))) {
    const currentContacts =
      (patch.contacts as unknown as EntityRow[] | undefined) ?? nextAllRows;
    const sourceContact =
      currentContacts.find((row) => String(row.id) === String(nextContact.id)) ?? nextContact;
    ficheLink = linkContactToOperationalRecord(sourceContact, state, linkSchoolCode);
    if (ficheLink.students) {
      patch.students = ficheLink.students as unknown as BackOfficeState["students"];
    }
    if (ficheLink.teachers) {
      patch.teachers = ficheLink.teachers as unknown as BackOfficeState["teachers"];
    }
    patch.contacts = currentContacts.map((row) =>
      String(row.id) === String(nextContact.id) ? ficheLink!.contact : row,
    ) as unknown as BackOfficeState["contacts"];
    if (ficheLink.linkedType) {
      const ficheLabel = ficheLink.linkedType === "student" ? "fiche élève" : "fiche enseignant";
      const baseMessage = ficheLink.created
        ? `Contact enregistré · ${ficheLabel} créée et reliée`
        : `Contact enregistré · ${ficheLabel} reliée`;
      if (promotion?.created && promotion.temporaryPassword) {
        successMessage = `${baseMessage} · mot de passe provisoire : ${promotion.temporaryPassword}`;
      } else {
        successMessage = baseMessage;
      }
    }
  }

  return {
    ok: true,
    patch,
    successMessage,
    promotion,
    ficheLink,
  };
}

export function buildContactMutationAuditEntries(input: {
  scopeUser: SessionUser | null;
  nextContact: EntityRow;
  exists: boolean;
  promotion: ContactPromotionResult | null;
  ficheLink: ContactLinkResult | null;
}): AuditEntry[] {
  const { scopeUser, nextContact, exists, promotion, ficheLink } = input;
  const label = contactDisplayLabel(nextContact);
  const entries: AuditEntry[] = [
    makeAuditEntry({
      ...auditActor(scopeUser),
      action: `contact.${exists ? "update" : "create"}`,
      entityType: "contact",
      entityId: String(nextContact.id ?? ""),
      entityLabel: label || undefined,
      schoolCode: String(nextContact.schoolCode ?? "") || undefined,
    }),
  ];

  if (String(nextContact.hasAccess ?? "") === "Oui") {
    entries.push(
      makeAuditEntry({
        ...auditActor(scopeUser),
        action: "user.role.assign",
        entityType: "user",
        entityId: String(nextContact.id ?? ""),
        entityLabel: label || undefined,
        schoolCode: String(nextContact.schoolCode ?? "") || undefined,
        details:
          promotion?.created && promotion.temporaryPassword
            ? [
                [String(nextContact.role ?? ""), String(nextContact.secondaryRole ?? "")]
                  .filter(Boolean)
                  .join(" + "),
                "Mot de passe provisoire généré",
              ]
                .filter(Boolean)
                .join(" · ")
            : [String(nextContact.role ?? ""), String(nextContact.secondaryRole ?? "")]
                .filter(Boolean)
                .join(" + "),
      }),
    );
  }

  if (ficheLink?.linkedType) {
    entries.push(
      makeAuditEntry({
        ...auditActor(scopeUser),
        action: `${ficheLink.linkedType}.${ficheLink.created ? "create" : "link"}`,
        entityType: ficheLink.linkedType,
        entityId: ficheLink.linkedRecordId,
        entityLabel: label || undefined,
        schoolCode: String(nextContact.schoolCode ?? "") || undefined,
        details: ficheLink.created
          ? "Fiche créée et reliée au contact"
          : "Fiche existante reliée au contact",
      }),
    );
  }

  return entries;
}

export function buildContactDeleteAuditEntry(
  scopeUser: SessionUser | null,
  row: EntityRow,
): AuditEntry {
  return makeAuditEntry({
    ...auditActor(scopeUser),
    action: "contact.delete",
    entityType: "contact",
    entityId: String(row.id ?? ""),
    entityLabel: contactDisplayLabel(row) || undefined,
    schoolCode: String(row.schoolCode ?? "") || undefined,
  });
}

export type ContactImportPlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: string;
    };

/**
 * Import Contacts à partir de lignes déjà parsées (I/O fichier hors module).
 */
export function buildContactImportPlan(
  deps: Pick<ContactAccountWorkflowDeps, "state" | "scopeUser" | "showToast">,
  input: {
    parsedRows: EntityRow[];
    fallbackSchool: string;
  },
): ContactImportPlan {
  const { state, scopeUser, showToast } = deps;
  const existing = (state.contacts as unknown as EntityRow[]).slice();
  const toAdd: EntityRow[] = [];
  const errors: string[] = [];

  input.parsedRows.forEach((raw, index) => {
    const line = index + 2;
    const prepared = prepareContactForSave(
      { ...raw, schoolCode: String(raw.schoolCode ?? "").trim() || input.fallbackSchool },
      state,
    );
    if (!prepared.lastName || !prepared.firstName || !prepared.contactType) {
      errors.push(`Ligne ${line} : nom, prénom ou type manquant.`);
      return;
    }
    if (!prepared.schoolCode) {
      errors.push(`Ligne ${line} : compte lié manquant.`);
      return;
    }
    const duplicate = validateContactDuplicate(prepared, [...existing, ...toAdd]);
    if (duplicate.block) {
      errors.push(`Ligne ${line} : ${duplicate.block}`);
      return;
    }
    toAdd.push({ ...prepared, id: newEntityId("CONTACTS") });
  });

  if (!toAdd.length) {
    showToast(`Aucun contact importé (${errors.length} ligne(s) en erreur).`, "error");
    return { ok: false };
  }

  return {
    ok: true,
    patch: {
      contacts: [...toAdd, ...existing] as unknown as BackOfficeState["contacts"],
      auditLog: appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: "contact.import",
          entityType: "contact",
          schoolCode: input.fallbackSchool || undefined,
          details: `${toAdd.length} importé(s)${
            errors.length ? `, ${errors.length} ignoré(s)` : ""
          }`,
        }),
      ),
    },
    successMessage: `${toAdd.length} contact(s) importé(s)${
      errors.length ? ` · ${errors.length} ignoré(s)` : ""
    }`,
  };
}

export type ContactPasswordResetGate =
  | { ok: false }
  | { ok: true; linkedUser: UserAccount };

export function buildContactPasswordResetGate(input: {
  editing: EntityRow | null;
  moduleKey: string | undefined;
  users: UserAccount[];
  canReset: (user: UserAccount) => boolean;
  showToast: ToastFn;
}): ContactPasswordResetGate {
  const { editing, moduleKey, users, canReset, showToast } = input;
  if (!editing?.id || moduleKey !== "contacts") return { ok: false };

  const linkedUser = findUserAccountForContact(editing, users);
  if (!linkedUser) {
    showToast("Aucun compte d'accès lié à ce contact.", "error");
    return { ok: false };
  }
  if (!canReset(linkedUser)) {
    showToast("Réinitialisation non autorisée pour ce compte.", "error");
    return { ok: false };
  }
  return { ok: true, linkedUser };
}

export type CreateFichePlan =
  | { ok: false }
  | {
      ok: true;
      patch: Partial<BackOfficeState>;
      successMessage: string;
    };

export function buildCreateFicheFromUserPlan(
  deps: Pick<ContactAccountWorkflowDeps, "state" | "scopeUser" | "showToast" | "syncSingleUserToTeachers">,
  input: { userId: string; moduleLabel: string },
): CreateFichePlan {
  const { state, scopeUser, showToast, syncSingleUserToTeachers: syncTeachers } = deps;
  const user = state.users.find((row) => String(row.id ?? "") === input.userId);
  if (!user) {
    showToast("Compte utilisateur introuvable.", "error");
    return { ok: false };
  }
  const teacherPatch = syncTeachers(state, user);
  const linkedTeacher = (teacherPatch.teachers as EntityRow[]).find(
    (row) => String(row.userId ?? "") === String(user.id ?? ""),
  );
  return {
    ok: true,
    patch: {
      teachers: teacherPatch.teachers as unknown as BackOfficeState["teachers"],
      auditLog: appendAuditLog(
        state.auditLog,
        makeAuditEntry({
          ...auditActor(scopeUser),
          action: "teacher.create",
          entityType: "teacher",
          entityId: String(linkedTeacher?.id ?? ""),
          entityLabel: `${user.firstName ?? ""} ${user.lastName ?? ""}`.trim() || undefined,
          schoolCode: String(user.schoolCode ?? "") || undefined,
          details: "Fiche créée depuis un compte utilisateur",
        }),
      ),
    },
    successMessage: `${input.moduleLabel} créé depuis le compte utilisateur`,
  };
}

export function buildCreateFicheFromContactPlan(
  deps: Pick<ContactAccountWorkflowDeps, "state" | "scopeUser" | "showToast">,
  input: {
    contactId: string;
    moduleLabel: string;
    /** Modale création fiche : effectiveSchoolCode. */
    effectiveSchoolCode: string;
  },
): CreateFichePlan {
  const { state, scopeUser, showToast } = deps;
  const contact = ((state.contacts ?? []) as unknown as EntityRow[]).find(
    (row) => String(row.id) === input.contactId,
  );
  if (!contact) {
    showToast("Contact introuvable.", "error");
    return { ok: false };
  }
  const link = linkContactToOperationalRecord(contact, state, input.effectiveSchoolCode);
  if (!link.linkedType) {
    showToast("Ce contact ne peut pas être relié à une fiche.", "error");
    return { ok: false };
  }
  const patch: Partial<BackOfficeState> = {};
  if (link.students) patch.students = link.students as unknown as BackOfficeState["students"];
  if (link.teachers) patch.teachers = link.teachers as unknown as BackOfficeState["teachers"];
  patch.contacts = ((state.contacts ?? []) as unknown as EntityRow[]).map((row) =>
    String(row.id) === input.contactId ? link.contact : row,
  ) as unknown as BackOfficeState["contacts"];
  const label = contactDisplayLabel(contact);
  patch.auditLog = appendAuditLog(
    state.auditLog,
    makeAuditEntry({
      ...auditActor(scopeUser),
      action: `${link.linkedType}.${link.created ? "create" : "link"}`,
      entityType: link.linkedType,
      entityId: link.linkedRecordId,
      entityLabel: label || undefined,
      schoolCode: String(contact.schoolCode ?? "") || undefined,
      details: link.created
        ? "Fiche créée depuis un contact existant"
        : "Fiche existante reliée au contact",
    }),
  );
  return {
    ok: true,
    patch,
    successMessage: link.created
      ? `${input.moduleLabel} créé depuis le contact`
      : "Fiche reliée au contact",
  };
}

/** Orchestrateur léger : parse sélection → plan user ou contact. */
export function buildCreateFicheFromSelectionPlan(
  deps: ContactAccountWorkflowDeps & { effectiveSchoolCode: string },
  input: { selectionValue: string; moduleLabel: string },
): CreateFichePlan {
  const selection = parseTeacherProvisioningSelection(input.selectionValue);
  if (!selection) {
    deps.showToast("Sélection invalide.", "error");
    return { ok: false };
  }
  if (selection.kind === "user") {
    return buildCreateFicheFromUserPlan(deps, {
      userId: selection.id,
      moduleLabel: input.moduleLabel,
    });
  }
  return buildCreateFicheFromContactPlan(deps, {
    contactId: selection.id,
    moduleLabel: input.moduleLabel,
    effectiveSchoolCode: deps.effectiveSchoolCode,
  });
}
