#!/usr/bin/env node
"use strict";

/**
 * P1 UX — garde-fou des libellés visibles Somafrik.
 *
 * Objectif : empêcher le retour de mots anglais fonctionnels dans les copies
 * utilisateur Mobile/Web, sans toucher aux contrats techniques (routes, enums,
 * clés JSON, codes RBAC, PostgreSQL, API, etc.).
 */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const UI_ROOTS = [path.join(ROOT, "Mobile", "src"), path.join(ROOT, "web", "src")];

const SOURCE_RE = /\.(tsx|jsx)$/i;
const SKIP_RE = /(?:^|\/)(?:__tests__|fixtures|mocks)(?:\/|$)|\.(?:test|spec)\.[jt]sx$/i;

const FORBIDDEN = [
  /\bTeachers?\b/i,
  /\bStudents?\b/i,
  /\bUsers?\b/i,
  /\bSchools?\b/i,
  /\bCourses?\b/i,
  /\bPayments?\b/i,
  /\bAttendance\b/i,
  /\bGrades?\b/i,
  /\bSettings\b/i,
  /\bDashboards?\b/i,
  /\bSave\b/i,
  /\bCancel\b/i,
  /\bDelete\b/i,
  /\bEdit\b/i,
  /\bCreate\b/i,
  /\bAdd\b/i,
  /\bSearch\b/i,
  /\bFilter\b/i,
  /\bLoading\b/i,
  /\bRetry\b/i,
  /\bRefresh\b/i,
  /\bNext\b/i,
  /\bPrevious\b/i,
  /\bLogin\b/i,
  /\bLogout\b/i,
  /\bPassword\b/i,
  /\bRole\b/i,
  /\bPending\b/i,
  /\bActive\b/i,
  /\bInactive\b/i,
  /\bApproved\b/i,
  /\bRejected\b/i,
  /\bArchived\b/i,
  /\bEnabled\b/i,
  /\bDisabled\b/i,
  /\bOverview\b/i,
  /\bMarketplace\b/i,
  /\bWeb[- ]only\b/i,
];

// Ces termes peuvent rester visibles : noms de technologies / formats et codes
// explicitement présentés comme techniques.
const ALLOWLIST = [
  /^PostgreSQL$/i,
  /^API$/i,
  /^RBAC$/i,
  /^JWT$/i,
  /^QR$/i,
  /^NFC$/i,
  /^URL$/i,
  /^PDF$/i,
  /^Expo$/i,
  /^Android$/i,
  /^iOS$/i,
  /^Somafrik$/i,
  /^Mobile Money$/i,
  /^SUPER_ADMIN$/,
  /^COUNTRY_ADMIN$/,
  /^SCHOOL_ADMIN$/,
  /^PREFET_ETUDES$/,
];

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function isAllowedWholeToken(value) {
  return ALLOWLIST.some((re) => re.test(String(value).trim()));
}

function extractUiStrings(source) {
  const found = [];
  const pushMatches = (re, group = 1) => {
    let match;
    while ((match = re.exec(source))) {
      const value = String(match[group] ?? "").replace(/&apos;/g, "'").trim();
      if (value) found.push(value);
    }
  };

  // Texte JSX littéral entre deux balises.
  pushMatches(/>\s*([^<>{}\n][^<>{}]*)\s*</g);

  // Props JSX destinées à l'utilisateur.
  pushMatches(
    /(?:title|subtitle|label|placeholder|accessibilityLabel|aria-label|description|message|emptyMessage|errorMessage|offlineMessage|loadingLabel|actionLabel|header|hint|documentTitle)\s*=\s*["']([^"']+)["']/g,
  );

  // Objets de configuration de navigation, tableaux, catalogues et formulaires.
  pushMatches(
    /(?:title|subtitle|label|placeholder|description|message|emptyMessage|errorMessage|offlineMessage|loadingLabel|actionLabel|header|hint|documentTitle)\s*:\s*["']([^"']+)["']/g,
  );

  // Alertes/toasts simples littéraux.
  pushMatches(/Alert\.alert\(\s*["']([^"']+)["']/g);
  pushMatches(/showToast\(\s*["']([^"']+)["']/g);

  return found;
}

function findForbidden(value) {
  if (isAllowedWholeToken(value)) return null;
  for (const re of FORBIDDEN) {
    const match = value.match(re);
    if (!match) continue;
    // Les codes techniques entre parenthèses restent permis si le libellé est
    // explicitement annoncé comme technique.
    if (/code technique/i.test(value) && /role_key/i.test(value) && /\bRole\b/i.test(match[0])) continue;
    return match[0];
  }
  return null;
}

function main() {
  const offenders = [];

  for (const root of UI_ROOTS) {
    for (const file of walk(root)) {
      const rel = path.relative(ROOT, file).replace(/\\/g, "/");
      if (!SOURCE_RE.test(file) || SKIP_RE.test(rel)) continue;
      const source = fs.readFileSync(file, "utf8");

      // Interdits absolus dans une source d'interface : jargon déjà observé en
      // production et formulations qui ne doivent jamais réapparaître.
      for (const hard of [
        { re: /GRANT\s*\/\s*REVOKE/gi, token: "GRANT/REVOKE" },
        { re: /Web[- ]only/gi, token: "Web-only" },
        { re: /label\s*:\s*["'](?:CREATE|READ|UPDATE|DELETE)["']/g, token: "CRUD anglais" },
      ]) {
        if (hard.re.test(source)) offenders.push(`${rel} — ${hard.token}`);
      }

      for (const value of extractUiStrings(source)) {
        const token = findForbidden(value);
        if (token) offenders.push(`${rel} — « ${value} » [${token}]`);
      }
    }
  }

  // Régressions structurantes déjà rencontrées sur Mobile.
  const navigatorPath = path.join(ROOT, "Mobile", "src", "navigation", "AppNavigator.tsx");
  const navigator = fs.readFileSync(navigatorPath, "utf8");
  for (const [route, title] of [
    ["Teachers", "Enseignants"],
    ["Payments", "Paiements"],
    ["Announcements", "Annonces"],
    ["StudentDetail", "Fiche élève"],
  ]) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`name=["']${escapedRoute}["'][^>]*options=\\{\\{[^}]*title:\\s*["']${escapedTitle}["']`, "s");
    assert.match(navigator, re, `${route} doit avoir le titre utilisateur français « ${title} »`);
  }

  const teachers = fs.readFileSync(path.join(ROOT, "Mobile", "src", "screens", "TeachersScreen.tsx"), "utf8");
  assert.doesNotMatch(teachers, /GRANT\s*\/\s*REVOKE|Web[- ]only/i);
  assert.match(teachers, /attribution et le retrait des droits/i);

  const webPermissions = fs.readFileSync(path.join(ROOT, "web", "src", "pages", "PermissionsPage.tsx"), "utf8");
  assert.doesNotMatch(webPermissions, /label\s*:\s*["'](?:CREATE|READ|UPDATE|DELETE)["']/);
  assert.match(webPermissions, /label:\s*"Création"/);
  assert.match(webPermissions, /label:\s*"Lecture"/);
  assert.match(webPermissions, /label:\s*"Modification"/);
  assert.match(webPermissions, /label:\s*"Suppression"/);

  if (offenders.length) {
    console.error("UI française non conforme :\n" + [...new Set(offenders)].sort().join("\n"));
    process.exit(1);
  }

  console.log("OK verify:ui-french-copy — copies utilisateur Mobile/Web contrôlées en français");
}

main();
