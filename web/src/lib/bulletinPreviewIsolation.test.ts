import { describe, expect, it } from "vitest";
import {
  BULLETIN_PREVIEW_CSP,
  BULLETIN_PREVIEW_SANDBOX,
  BulletinPreviewError,
  GRAPES_CANVAS_CSP,
  applyCanvasContentSecurityPolicy,
  GRAPES_SAFE_PARSER_OPTIONS,
  MAX_BULLETIN_PREVIEW_CHARS,
  MAX_GRAPES_PROJECT_DEPTH,
  buildIsolatedPreviewDocument,
  sanitizeGrapesProjectData,
} from "./bulletinPreviewIsolation";

function project(components: unknown[]) {
  return { pages: [{ frames: [{ component: { type: "wrapper", components } }] }] };
}

function firstComponents(value: Record<string, unknown> | null): Record<string, unknown>[] {
  const pages = value?.pages as { frames: { component: { components: Record<string, unknown>[] } }[] }[];
  return pages[0].frames[0].component.components;
}

describe("SEC-XSS-01 — document d'aperçu isolé", () => {
  it("sandbox sans aucune permission", () => {
    expect(BULLETIN_PREVIEW_SANDBOX).toBe("");
  });

  it("CSP : aucun script, aucun réseau, seulement data: pour images et polices", () => {
    expect(BULLETIN_PREVIEW_CSP).toContain("default-src 'none'");
    expect(BULLETIN_PREVIEW_CSP).toContain("img-src data:");
    expect(BULLETIN_PREVIEW_CSP).toContain("font-src data:");
    expect(BULLETIN_PREVIEW_CSP).toContain("form-action 'none'");
    expect(BULLETIN_PREVIEW_CSP).toContain("base-uri 'none'");
    expect(BULLETIN_PREVIEW_CSP).not.toMatch(/script-src|unsafe-eval|https?:|\*/);
  });

  it("la CSP précède tout contenu du modèle", () => {
    const doc = buildIsolatedPreviewDocument("<p>Bulletin</p>");
    const cspIndex = doc.indexOf('http-equiv="Content-Security-Policy"');
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf("<p>Bulletin</p>"));
    expect(doc).toContain(BULLETIN_PREVIEW_CSP);
  });

  it("modèle vide, non textuel ou trop volumineux : échec contrôlé", () => {
    for (const value of ["", "   ", null, undefined, 42, {}, "x".repeat(MAX_BULLETIN_PREVIEW_CHARS + 1)]) {
      expect(() => buildIsolatedPreviewDocument(value)).toThrow(BulletinPreviewError);
    }
  });
});

describe("SEC-XSS-01 — projet GrapesJS enregistré", () => {
  it("retire gestionnaires on*, srcdoc et URL actives ; conserve le reste", () => {
    const safe = sanitizeGrapesProjectData(
      project([
        {
          tagName: "img",
          attributes: { src: "data:image/png;base64,AA==", alt: "logo", onerror: "marker()", OnLoad: "marker()" },
        },
        { tagName: "a", attributes: { href: " Java\tScript:marker()", title: "lien" } },
        { tagName: "a", attributes: { href: "https://somafrik.app/aide" } },
        { tagName: "div", attributes: { srcdoc: "<p>x</p>", class: "bloc" }, style: { color: "red" } },
      ]),
    );
    const [img, jsLink, okLink, div] = firstComponents(safe);
    expect(img.attributes).toEqual({ src: "data:image/png;base64,AA==", alt: "logo" });
    expect(jsLink.attributes).toEqual({ title: "lien" });
    expect(okLink.attributes).toEqual({ href: "https://somafrik.app/aide" });
    expect(div.attributes).toEqual({ class: "bloc" });
    expect(div.style).toEqual({ color: "red" });
  });

  it("supprime les balises actives et les propriétés de script", () => {
    const safe = sanitizeGrapesProjectData(
      project([
        { tagName: "script", content: "marker()" },
        { type: "iframe", attributes: { src: "https://example.invalid" } },
        { tagName: "object" },
        { tagName: "embed" },
        { tagName: "form" },
        { tagName: "section", script: "function(){}", "script-export": "x", components: [{ tagName: "p", content: "<b>ok</b>" }] },
      ]),
    );
    const components = firstComponents(safe);
    expect(components).toHaveLength(1);
    expect(components[0].tagName).toBe("section");
    expect(components[0]).not.toHaveProperty("script");
    expect(components[0]).not.toHaveProperty("script-export");
    expect((components[0].components as Record<string, unknown>[])[0].content).toBe("bok/b");
  });

  it("entrées non objet ou malformées : null, sans exception", () => {
    for (const value of [null, undefined, "", "<div>", 42, true, [], [1, 2]]) {
      expect(sanitizeGrapesProjectData(value)).toBeNull();
    }
    expect(sanitizeGrapesProjectData({ pages: "pas un tableau", styles: 12, assets: null })).toEqual({
      pages: "pas un tableau",
      styles: 12,
      assets: null,
    });
  });

  it("imbrication très profonde : tronquée sans dépassement de pile", () => {
    let node: Record<string, unknown> = { tagName: "p", attributes: { onclick: "marker()" } };
    for (let i = 0; i < 20_000; i += 1) node = { tagName: "div", components: [node] };
    const started = Date.now();
    const safe = sanitizeGrapesProjectData({ pages: [{ frames: [{ component: node }] }] });
    expect(Date.now() - started).toBeLessThan(2000);
    expect(JSON.stringify(safe)).not.toContain("onclick");
    expect(MAX_GRAPES_PROJECT_DEPTH).toBeLessThan(1000);
  });

  it("structures cycliques : pas de boucle infinie", () => {
    const loop: Record<string, unknown> = { tagName: "div" };
    loop.components = [loop];
    const safe = sanitizeGrapesProjectData({ pages: [{ frames: [{ component: loop }] }] });
    expect(safe).not.toBeNull();
  });

  it("références partagées légitimes conservées (non cycliques)", () => {
    const sharedStyle = { color: "#0f172a", "font-weight": "700" };
    const sharedCell = { tagName: "td", content: "Note", attributes: { class: "cell" } };
    const safe = sanitizeGrapesProjectData(
      project([
        { tagName: "p", style: sharedStyle },
        { tagName: "p", style: sharedStyle },
        { tagName: "tr", components: [sharedCell, sharedCell] },
      ]),
    );
    const [first, second, row] = firstComponents(safe);
    expect(first.style).toEqual(sharedStyle);
    expect(second.style).toEqual(sharedStyle);
    expect(row.components).toEqual([sharedCell, sharedCell]);
  });

  it("cycle réel coupé, branches sœurs partagées conservées", () => {
    const shared = { tagName: "span", content: "ok" };
    const loop: Record<string, unknown> = { tagName: "div", components: [shared] };
    (loop.components as unknown[]).push(loop, shared);
    const safe = sanitizeGrapesProjectData(project([loop]));
    const [div] = firstComponents(safe);
    expect(div.components).toEqual([shared, shared]);
    expect(() => JSON.stringify(safe)).not.toThrow();
  });

  it("clés de prototype et valeurs non JSON ignorées", () => {
    const raw = JSON.parse('{"pages":[],"__proto__":{"polluted":true},"constructor":{"x":1}}');
    const safe = sanitizeGrapesProjectData({ ...raw, fn: () => 1, sym: Symbol("s") });
    expect(safe).toEqual({ pages: [] });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("options de l'analyseur et CSP du canevas figées", () => {
    expect(GRAPES_SAFE_PARSER_OPTIONS).toEqual({ allowScripts: false, allowUnsafeAttr: false, allowUnsafeAttrValue: false });
    expect(Object.isFrozen(GRAPES_SAFE_PARSER_OPTIONS)).toBe(true);
    expect(GRAPES_CANVAS_CSP).toContain("script-src 'none'");
    expect(GRAPES_CANVAS_CSP).toContain("frame-src 'none'");
  });

  it("CSP du canevas insérée en tête du <head>", () => {
    const doc = document.implementation.createHTMLDocument("canevas");
    doc.head.appendChild(doc.createElement("style"));
    expect(applyCanvasContentSecurityPolicy(doc)).toBe(true);
    const first = doc.head.firstElementChild as HTMLMetaElement;
    expect(first.httpEquiv).toBe("Content-Security-Policy");
    expect(first.content).toBe(GRAPES_CANVAS_CSP);
    expect(applyCanvasContentSecurityPolicy(null)).toBe(false);
  });
});
