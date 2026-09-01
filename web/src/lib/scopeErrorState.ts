import type { BackOfficeState, SessionUser } from "../types";
import type { DomainKey } from "./domainLoaders";
import { projectScopedUsers } from "./scope";
import { projectScopedStudents } from "./studentsScope";

export type DomainScopeErrors = {
  users: string | null;
  students: string | null;
};

export const EMPTY_DOMAIN_SCOPE_ERRORS: DomainScopeErrors = {
  users: null,
  students: null,
};

export function mergeDomainScopeErrors(
  previous: DomainScopeErrors,
  patch: Partial<DomainScopeErrors>,
): DomainScopeErrors {
  return {
    users: patch.users !== undefined ? patch.users : previous.users,
    students: patch.students !== undefined ? patch.students : previous.students,
  };
}

export function combinedScopeError(errors: DomainScopeErrors): string | null {
  const messages = [errors.users, errors.students].filter((message): message is string => Boolean(message));
  return messages.length ? messages.join(" ") : null;
}

/**
 * Patch par domaine réellement rechargé.
 * `state` doit être le payload GET (avant applyClientScopeToState) :
 * une ligne sans schoolId disparaît du state filtré, l'alerte doit rester.
 * Un GET /users propre ne doit pas effacer une erreur Students encore valide,
 * et un GET /students propre doit poser students = null.
 */
export function scopeErrorPatchFromLoadedDomains(
  loadedKeys: readonly DomainKey[],
  user: SessionUser | null,
  state: Pick<BackOfficeState, "users" | "students">,
): Partial<DomainScopeErrors> {
  const patch: Partial<DomainScopeErrors> = {};
  if (!user) return patch;
  if (loadedKeys.includes("users")) {
    patch.users = projectScopedUsers(user, {
      users: state.users ?? [],
      schools: [],
      countries: [],
      subscriptions: [],
      notifications: [],
    }).error?.message ?? null;
  }
  if (loadedKeys.includes("students")) {
    patch.students = projectScopedStudents(user, state).error?.message ?? null;
  }
  return patch;
}
