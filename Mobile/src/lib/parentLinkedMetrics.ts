/**
 * Affichage Parent quand le scope canonique est vide.
 * Un parent sans enfant lié ne doit jamais présenter un KPI 0/0.
 */

export const PARENT_UNLINKED_COPY = "Aucun enfant lié";
export const PARENT_UNLINKED_KPI = "—";

export function countLinkedParentChildren(user: { children?: unknown } | null | undefined): number {
  return Array.isArray(user?.children) ? user.children.length : 0;
}

export function parentChildNameFromSession(input: {
  user?: { children?: Array<{ id?: string | null; name?: string | null; studentUuid?: string | null }> | null } | null;
  aliasKeys?: string[];
  rosterName?: string | null;
}): string {
  const roster = String(input.rosterName ?? "").trim();
  if (roster) return roster;
  const allowed = new Set((input.aliasKeys ?? []).map((key) => String(key ?? "").trim()).filter(Boolean));
  const child = (input.user?.children ?? []).find((item) =>
    [item?.id, item?.studentUuid].some((value) => allowed.has(String(value ?? "").trim())),
  );
  return String(child?.name ?? "").trim();
}

export function parentHomeIdentityName(input: {
  childName?: string | null;
  linkedCount: number;
}): string {
  const name = String(input.childName ?? "").trim();
  if (name && name !== "Élève") return name;
  if (input.linkedCount === 0) return PARENT_UNLINKED_COPY;
  return name || "Élève";
}

export function parentRatioKpiLabel(input: {
  linkedCount: number;
  ready: boolean;
  numerator: number;
  denominator: number;
}): string {
  if (input.linkedCount === 0) return PARENT_UNLINKED_KPI;
  if (!input.ready) return PARENT_UNLINKED_KPI;
  return `${input.numerator}/${input.denominator}`;
}

export function parentPresenceSummary(input: {
  linkedCount: number;
  ready: boolean;
  attended: number;
  total: number;
  justified: number;
  rate: number;
}): { rate: string; meta: string } {
  if (input.linkedCount === 0) {
    return { rate: PARENT_UNLINKED_KPI, meta: PARENT_UNLINKED_COPY };
  }
  if (!input.ready) {
    return { rate: PARENT_UNLINKED_KPI, meta: PARENT_UNLINKED_KPI };
  }
  return {
    rate: `${input.rate}%`,
    meta: `${input.attended}/${input.total} présent(s), ${input.justified} justifié(s)`,
  };
}
