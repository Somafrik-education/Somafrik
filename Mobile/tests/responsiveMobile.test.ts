import { describe, it, expect } from "vitest";

import {
  RESPONSIVE_VIEWPORTS,
  TABLET_CONTENT_MAX_WIDTH,
  expectedContentMaxWidth,
  isTabletViewport,
} from "../src/lib/responsiveMobileSpec";

describe("responsiveMobileSpec", () => {
  it("couvre petit Android, iPhone, grand Android et tablette", () => {
    const categories = new Set(RESPONSIVE_VIEWPORTS.map((item) => item.category));
    expect(categories.has("small-android")).toBe(true);
    expect(categories.has("iphone")).toBe(true);
    expect(categories.has("large-android")).toBe(true);
    expect(categories.has("tablet")).toBe(true);
  });

  it("inclut portrait prioritaire et paysage téléphone", () => {
    const orientations = new Set(RESPONSIVE_VIEWPORTS.map((item) => item.orientation));
    expect(orientations.has("portrait")).toBe(true);
    expect(orientations.has("landscape")).toBe(true);
  });

  it("limite la largeur de contenu sur tablette", () => {
    expect(isTabletViewport({ width: 768 })).toBe(true);
    expect(expectedContentMaxWidth({ width: 768 })).toBe(704);
    expect(expectedContentMaxWidth({ width: 1200 })).toBe(TABLET_CONTENT_MAX_WIDTH);
  });

  it("utilise toute la largeur sur téléphone", () => {
    expect(expectedContentMaxWidth({ width: 360 })).toBe(360);
    expect(expectedContentMaxWidth({ width: 412 })).toBe(412);
  });
});
