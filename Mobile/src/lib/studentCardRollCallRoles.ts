/**
 * CARTE-UX-ROLE-01 — parcours affichés selon les clés de rôle canoniques et les permissions
 * effectives de la session (jamais selon un libellé). Le serveur reste seul juge : ces
 * décisions ne servent qu'à ne pas proposer un parcours qui serait refusé.
 */
import { resolveCanonicalRoleIdentity } from "./canonicalRoleIdentity";

const DIRECTION_ROLE_KEYS = new Set(["PROVISEUR", "PRINCIPAL", "PREFET_ETUDES", "SCHOOL_ADMIN"]);
const STAFF_ROLE_KEYS = new Set([...DIRECTION_ROLE_KEYS, "TEACHER", "SECRETARY", "SUPERVISOR", "ACCOUNTANT"]);
const PLATFORM_ROLE_KEYS = new Set(["SUPER_ADMIN", "COUNTRY_ADMIN"]);

export type RollCallActor = { teacher: boolean; direction: boolean; supervision: boolean; verify: boolean };

export function rollCallActor(session: unknown): RollCallActor {
  const identity = resolveCanonicalRoleIdentity(session);
  const keys = identity.roleKeys.map((key) => String(key).trim().toUpperCase()).filter(Boolean);
  const none = { teacher: false, direction: false, supervision: false, verify: false };
  // Clé inconnue, rôle plateforme ou famille : aucun parcours réservé au personnel.
  if (keys.length === 0 || keys.some((key) => !STAFF_ROLE_KEYS.has(key) || PLATFORM_ROLE_KEYS.has(key))) return none;
  const permissions = new Set(identity.permissions);
  const isDirection = keys.some((key) => DIRECTION_ROLE_KEYS.has(key));
  return {
    teacher: keys.includes("TEACHER"),
    direction: isDirection && permissions.has("Présences:UPDATE"),
    supervision: isDirection,
    verify: true,
  };
}

export type RollCallOverviewClass = {
  classId: string;
  classCode: string;
  className: string;
  enrolled: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  recorded: number;
  notRecorded: number;
  status: "not_started" | "partial" | "complete";
  lastUpdatedAt: string | null;
};

export type RollCallOverview = { date: string; classes: RollCallOverviewClass[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const count = (value: unknown) => (Number.isInteger(value) && (value as number) > 0 ? (value as number) : 0);
const text = (value: unknown) => (typeof value === "string" ? value.slice(0, 120) : "");

/** Liste blanche : seuls les compteurs par classe sont conservés, tout autre champ est ignoré. */
export function parseRollCallOverview(raw: unknown): RollCallOverview | null {
  const value = raw && typeof raw === "object" ? (raw as { date?: unknown; classes?: unknown }) : null;
  if (!value || !Array.isArray(value.classes)) return null;
  const classes: RollCallOverviewClass[] = [];
  for (const item of value.classes) {
    const row = item && typeof item === "object" ? (item as Record<string, unknown>) : null;
    if (!row || typeof row.classId !== "string" || !UUID.test(row.classId)) continue;
    const status = row.status === "partial" || row.status === "complete" ? row.status : "not_started";
    classes.push({
      classId: row.classId,
      classCode: text(row.classCode),
      className: text(row.className),
      enrolled: count(row.enrolled),
      present: count(row.present),
      absent: count(row.absent),
      late: count(row.late),
      excused: count(row.excused),
      recorded: count(row.recorded),
      notRecorded: count(row.notRecorded),
      status,
      lastUpdatedAt: typeof row.lastUpdatedAt === "string" && !Number.isNaN(Date.parse(row.lastUpdatedAt)) ? row.lastUpdatedAt : null,
    });
  }
  return { date: text(value.date), classes };
}

export const ROLL_CALL_OVERVIEW_COPY = {
  title: "Supervision des appels",
  subtitle: "État des appels du jour par classe. Aucune donnée d'élève n'est affichée.",
  refresh: "Actualiser",
  loading: "Chargement de la supervision…",
  failed: "Supervision indisponible. Réessayez.",
  empty: "Aucune classe active.",
  status: { not_started: "Appel non commencé", partial: "Appel partiel", complete: "Appel complet" },
  line: (row: RollCallOverviewClass) =>
    `${row.recorded} / ${row.enrolled} enregistré(s) — ${row.present} présent(s), ${row.absent} absent(s), ${row.late} retard(s), ${row.excused} excusé(s)`,
} as const;
