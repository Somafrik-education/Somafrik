import { useEffect, useReducer } from "react";
import type { BackOfficeState, SessionUser } from "../types";
import { scopedAnnouncements } from "./establishment";

/**
 * Suivi des annonces déjà consultées par utilisateur.
 * Les annonces n'ont pas de statut lu/non-lu par destinataire côté données ;
 * on mémorise donc localement (localStorage) les identifiants déjà vus pour
 * alimenter la pastille de non-lus de l'icône Annonces.
 */

const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function storageKey(userId: string): string {
  return `somafrik:announcements:read:${userId}`;
}

function readIds(userId: string): Set<string> {
  if (typeof window === "undefined" || !userId) return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value)) : []);
  } catch {
    return new Set();
  }
}

function writeIds(userId: string, ids: Set<string>): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify([...ids]));
  } catch {
    /* quota dépassé ou stockage indisponible : on ignore */
  }
}

/** Nombre d'annonces (dans le périmètre de l'utilisateur) jamais consultées. */
export function countUnreadAnnouncements(
  user: SessionUser | null,
  state: BackOfficeState,
): number {
  const userId = String(user?.id ?? "");
  if (!userId) return 0;
  const read = readIds(userId);
  return scopedAnnouncements(user, state).filter((row) => !read.has(String(row.id))).length;
}

/** Marque toutes les annonces du périmètre comme lues et notifie les abonnés. */
export function markAllAnnouncementsRead(
  user: SessionUser | null,
  state: BackOfficeState,
): void {
  const userId = String(user?.id ?? "");
  if (!userId) return;
  const current = readIds(userId);
  const ids = scopedAnnouncements(user, state)
    .map((row) => String(row.id))
    .filter(Boolean);
  let changed = false;
  for (const id of ids) {
    if (!current.has(id)) {
      current.add(id);
      changed = true;
    }
  }
  if (!changed) return;
  writeIds(userId, current);
  emit();
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
