const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");

function patch(relative, replacements, importLine) {
  const file = path.join(ROOT, relative);
  let source = fs.readFileSync(file, "utf8");
  let changed = false;
  if (importLine && !source.includes(importLine)) {
    source = `${importLine}\n${source}`;
    changed = true;
  }
  for (const [before, after] of replacements) {
    if (source.includes(after)) continue;
    if (!source.includes(before)) {
      throw new Error(`${relative}: motif attendu introuvable: ${before.slice(0, 80)}`);
    }
    source = source.replace(before, after);
    changed = true;
  }
  if (changed) fs.writeFileSync(file, source, "utf8");
  console.log(`${changed ? "PATCHED" : "OK"} ${relative}`);
}

const WEB_DATETIME = `function formatDateTime(value?: string): string {\n  if (!value) return "";\n  const date = new Date(value);\n  if (Number.isNaN(date.getTime())) return value;\n  return new Intl.DateTimeFormat("fr-FR", {\n    dateStyle: "short",\n    timeStyle: "short",\n  }).format(date);\n}`;
const DISPLAY_DATETIME = `function formatDisplayDate(iso?: string) {\n  if (!iso) return "";\n  const date = new Date(iso);\n  if (Number.isNaN(date.getTime())) return iso;\n  return new Intl.DateTimeFormat("fr-FR", {\n    day: "2-digit",\n    month: "2-digit",\n    year: "numeric",\n    hour: "2-digit",\n    minute: "2-digit",\n  }).format(date);\n}`;

patch(
  "web/src/components/communications/InternalNotificationsCenter.tsx",
  [[WEB_DATETIME, "const formatDateTime = formatDateTimeForDisplay;"]],
  `import { formatDateTimeForDisplay } from "../../lib/dates";`,
);
patch(
  "web/src/pages/AnnouncementsPage.tsx",
  [[DISPLAY_DATETIME, "const formatDisplayDate = formatDateTimeForDisplay;"]],
  `import { formatDateTimeForDisplay } from "../lib/dates";`,
);
patch(
  "web/src/pages/MessagesConversationsPage.tsx",
  [[DISPLAY_DATETIME, "const formatDisplayDate = formatDateTimeForDisplay;"]],
  `import { formatDateTimeForDisplay } from "../lib/dates";`,
);
patch(
  "web/src/pages/CountriesPage.tsx",
  [[`new Date().toLocaleDateString("fr-FR")`, `new Date().toISOString()`]],
);
patch(
  "web/src/pages/PlatformNotificationsPage.tsx",
  [[`new Date().toLocaleDateString("fr-FR").replace(/\\//g, "-")`, `formatDateForDisplay(new Date())`]],
  `import { formatDateForDisplay } from "../lib/dates";`,
);
patch(
  "web/src/pages/SubscriptionsPage.tsx",
  [[`nextYear.toLocaleDateString("fr-FR").replace(/\\//g, "-")`, `formatDateForDisplay(nextYear)`]],
  `import { formatDateForDisplay } from "../lib/dates";`,
);
patch(
  "web/src/pages/abonnements/SubscriptionSchoolsPage.tsx",
  [[`nextYear.toLocaleDateString("fr-FR").replace(/\\//g, "-")`, `formatDateForDisplay(nextYear)`]],
  `import { formatDateForDisplay } from "../../lib/dates";`,
);

const PICKER_FORMAT = `function formatDisplay(value?: string): string {\n  const parsed = parseISO(value);\n  if (!parsed) return "";\n  return \`${'${pad(parsed.d)}'}/${'${pad(parsed.m + 1)}'}/${'${parsed.y}'}\`;\n}`;
patch(
  "web/src/components/ui/DatePicker.tsx",
  [
    [PICKER_FORMAT, `const formatDisplay = formatDateForDisplay;`],
    [`placeholder = "JJ/MM/AAAA"`, `placeholder = "JJ-MM-AAAA"`],
  ],
  `import { formatDateForDisplay } from "../../lib/dates";`,
);

const MOBILE_DISPLAY_DATETIME = DISPLAY_DATETIME;
const MOBILE_DATETIME = `function formatDateTime(value?: string) {\n  if (!value) return "";\n  const date = new Date(value);\n  if (Number.isNaN(date.getTime())) return value;\n  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "short" }).format(date);\n}`;
patch(
  "Mobile/src/screens/AnnouncementsScreen.tsx",
  [[MOBILE_DISPLAY_DATETIME, "const formatDisplayDate = formatDateTimeForDisplay;"]],
  `import { formatDateTimeForDisplay } from "../lib/dates";`,
);
patch(
  "Mobile/src/screens/InternalNotificationsScreen.tsx",
  [[MOBILE_DATETIME, "const formatDateTime = formatDateTimeForDisplay;"]],
  `import { formatDateTimeForDisplay } from "../lib/dates";`,
);
patch(
  "Mobile/src/screens/PlatformNotificationsScreen.tsx",
  [[`new Date().toLocaleDateString("fr-FR").replace(/\\//g, "-")`, `formatDateForDisplay(new Date())`]],
  `import { formatDateForDisplay } from "../lib/dates";`,
);
