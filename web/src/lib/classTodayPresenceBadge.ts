/**
 * Badge « Présence » des cartes classe Web.
 *
 * Même contrat fail-closed que Mobile/src/lib/classTodayPresenceBadge.ts :
 * - 0 élève attendu → « Présence — », jamais un pourcentage
 * - élèves mais appel incomplet / absent → « Non saisi », jamais 0 %
 * - recorded >= expected → taux du jour (Présent + Retard)
 */
export const CLASS_UNSET_PRESENCE_LABEL = "Non saisi";
export const CLASS_EMPTY_PRESENCE_BADGE = "Présence —";

export type ClassTodayPresenceKind = "empty" | "unset" | "rate";

export type ClassTodayPresenceBadge = {
  kind: ClassTodayPresenceKind;
  badgeText: string;
  rate: number | null;
  expected: number;
  recorded: number;
  attended: number;
};

export function formatClassTodayPresenceBadge(input: {
  expected: number;
  recorded: number;
  attended: number;
}): ClassTodayPresenceBadge {
  const expected = Math.max(0, Number(input.expected) || 0);
  const recorded = Math.max(0, Number(input.recorded) || 0);
  const attended = Math.max(0, Number(input.attended) || 0);

  if (expected <= 0) {
    return {
      kind: "empty",
      badgeText: CLASS_EMPTY_PRESENCE_BADGE,
      rate: null,
      expected: 0,
      recorded: 0,
      attended: 0,
    };
  }

  if (recorded === 0 || recorded < expected) {
    return {
      kind: "unset",
      badgeText: CLASS_UNSET_PRESENCE_LABEL,
      rate: null,
      expected,
      recorded,
      attended,
    };
  }

  const rate = Math.min(100, Math.round((attended / expected) * 100));
  return {
    kind: "rate",
    badgeText: `Présence ${rate} %`,
    rate,
    expected,
    recorded,
    attended,
  };
}
