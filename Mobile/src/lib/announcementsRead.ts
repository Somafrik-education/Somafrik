import { useEffect, useReducer } from "react";

/**
 * Suivi (en mémoire) des annonces déjà consultées par utilisateur.
 * Les annonces ne portent pas de statut lu/non-lu par destinataire ; on retient
 * donc les identifiants vus pendant la session pour alimenter la pastille de
 * non-lus de l'icône Annonces. L'app mobile ne persiste pas la session, ce
 * suivi suit la même logique et se réinitialise au redémarrage.
 */

type Identifiable = { id?: string | number };

const readByUser = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function getSet(userId: string): Set<string> {
  let set = readByUser.get(userId);
  if (!set) {
    set = new Set();
    readByUser.set(userId, set);
  }
  return set;
}

/** Nombre d'annonces jamais consultées par cet utilisateur. */
export function countUnreadAnnouncements(
  userId: string | null | undefined,
  announcements: Identifiable[],
): number {
  if (!userId) return 0;
  const read = readByUser.get(userId);
  if (!read) return announcements.length;
  return announcements.filter((item) => !read.has(String(item?.id ?? ""))).length;
}

/** Marque les annonces fournies comme lues et notifie les abonnés. */
export function markAnnouncementsRead(
  userId: string | null | undefined,
  announcements: Identifiable[],
): void {
  if (!userId) return;
  const set = getSet(userId);
  let changed = false;
  for (const item of announcements) {
    const id = String(item?.id ?? "");
    if (id && !set.has(id)) {
      set.add(id);
      changed = true;
    }
  }
  if (changed) emit();
}

/** Force un re-render lorsque l'état « annonces lues » change. */
export function useAnnouncementsReadListener(): void {
  const [, force] = useReducer((value: number) => value + 1, 0);
  useEffect(() => {
    listeners.add(force);
    return () => {
      listeners.delete(force);
    };
  }, []);
}
