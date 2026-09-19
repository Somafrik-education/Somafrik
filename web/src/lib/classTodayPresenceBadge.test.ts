import { describe, expect, it } from "vitest";
import {
  CLASS_EMPTY_PRESENCE_BADGE,
  CLASS_UNSET_PRESENCE_LABEL,
  formatClassTodayPresenceBadge,
} from "./classTodayPresenceBadge";

describe("formatClassTodayPresenceBadge — fail-closed", () => {
  it("classe vide → Présence —", () => {
    expect(formatClassTodayPresenceBadge({ expected: 0, recorded: 0, attended: 0 })).toEqual({
      kind: "empty",
      badgeText: CLASS_EMPTY_PRESENCE_BADGE,
      rate: null,
      expected: 0,
      recorded: 0,
      attended: 0,
    });
  });

  it("élèves sans appel → Non saisi, jamais 0 %", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 3, recorded: 0, attended: 0 });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.rate).toBeNull();
  });

  it("appel partiel → Non saisi, jamais un pourcentage trompeur", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 3, recorded: 2, attended: 2 });
    expect(badge.kind).toBe("unset");
    expect(badge.badgeText).toBe(CLASS_UNSET_PRESENCE_LABEL);
    expect(badge.rate).toBeNull();
  });

  it("appel complet tous absents → Présence 0 %", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 3, recorded: 3, attended: 0 });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 0 %");
    expect(badge.rate).toBe(0);
  });

  it("appel complet mixte → taux Présent+Retard / expected", () => {
    const badge = formatClassTodayPresenceBadge({ expected: 4, recorded: 4, attended: 3 });
    expect(badge.kind).toBe("rate");
    expect(badge.badgeText).toBe("Présence 75 %");
    expect(badge.rate).toBe(75);
  });
});
