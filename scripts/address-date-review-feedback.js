const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const WEB_SRC = path.join(ROOT, "web", "src");
const DATE_INPUT_PATH = path.join(WEB_SRC, "components", "ui", "DateInput.tsx");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function write(relative, content) {
  const file = path.join(ROOT, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

function replaceOrFail(relative, before, after) {
  const source = read(relative);
  if (source.includes(after)) return false;
  if (!source.includes(before)) throw new Error(`${relative}: motif attendu introuvable`);
  write(relative, source.replace(before, after));
  return true;
}

const dateInput = `import type { ChangeEvent, InputHTMLAttributes } from "react";
import { DatePicker } from "./DatePicker";

export type DateInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Adaptateur formulaire pour le DatePicker Somafrik.
 * La valeur contrôlée reste canonique YYYY-MM-DD, tandis que l'utilisateur voit JJ-MM-AAAA.
 */
export function DateInput({
  id,
  name,
  value,
  onChange,
  required,
  disabled,
  readOnly,
  className,
  placeholder,
  min,
  max,
  autoFocus,
  ...props
}: DateInputProps) {
  const current = value == null ? "" : String(value);
  const minValue = min == null ? "" : String(min);
  const maxValue = max == null ? "" : String(max);
  const dataTestId = (props as Record<string, unknown>)["data-testid"] as string | undefined;

  const emitChange = (next: string) => {
    if ((minValue && next < minValue) || (maxValue && next > maxValue)) return;
    if (!onChange) return;
    const target = { value: next, name: name ?? "", id: id ?? "" } as HTMLInputElement;
    onChange({ target, currentTarget: target } as ChangeEvent<HTMLInputElement>);
  };

  return (
    <>
      <DatePicker
        id={id}
        value={current}
        onChange={emitChange}
        required={required}
        disabled={disabled}
        readOnly={readOnly}
        className={className}
        placeholder={placeholder}
        min={minValue || undefined}
        max={maxValue || undefined}
        autoFocus={autoFocus}
        aria-invalid={props["aria-invalid"]}
        aria-describedby={props["aria-describedby"]}
        data-testid={dataTestId}
      />
      {name ? <input type="hidden" name={name} value={current} disabled={disabled} /> : null}
    </>
  );
}
`;
write("web/src/components/ui/DateInput.tsx", dateInput);

// P1: timestamps represent instants and must be converted to the viewer/device timezone.
const webDates = "web/src/lib/dates.ts";
let webSource = read(webDates);
const webStart = webSource.indexOf("/**\n * Affiche un horodatage");
const webEnd = webSource.indexOf("\n/** Normalise", webStart);
if (webStart < 0 || webEnd < 0) throw new Error("web dates: bloc formatDateTimeForDisplay introuvable");
const webDateTime = `/**
 * Affiche un horodatage dans le fuseau local du navigateur. Les dates civiles restent
 * traitées séparément par formatDateForDisplay afin d'éviter tout décalage UTC implicite.
 */
export function formatDateTimeForDisplay(value?: string | Date | null): string {
  const raw = value instanceof Date ? value : String(value ?? "").trim();
  if (raw === "") return "";
  if (typeof raw === "string" && !/[T ]\\d{2}:\\d{2}/.test(raw)) return formatDateForDisplay(raw);
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return \`${"${formatPeriodDate(parsed)} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}"}\`;
}
`;
webSource = webSource.slice(0, webStart) + webDateTime + webSource.slice(webEnd);
write(webDates, webSource);

const mobileDates = "Mobile/src/lib/dates.ts";
let mobileSource = read(mobileDates);
const mobileStart = mobileSource.indexOf("export function formatDateTimeForDisplay");
if (mobileStart < 0) throw new Error("mobile dates: formatDateTimeForDisplay introuvable");
const mobileDateTime = `export function formatDateTimeForDisplay(value?: string | Date | null): string {
  const raw = value instanceof Date ? value : String(value ?? "").trim();
  if (raw === "") return "";
  if (typeof raw === "string" && !/[T ]\\d{2}:\\d{2}/.test(raw)) return formatDateForDisplay(raw);
  const parsed = value instanceof Date ? value : new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return \`${"${formatDateForDisplay(parsed)} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}"}\`;
}
`;
mobileSource = mobileSource.slice(0, mobileStart) + mobileDateTime;
write(mobileDates, mobileSource);

const oldWebTest = `  it("conserve l'heure métier sur les timestamps", () => {\n    expect(formatDateTimeForDisplay("2026-09-17T14:35:00+02:00")).toMatch(/^17-09-2026 14:35$/);\n  });`;
const newWebTest = `  it("convertit les timestamps dans le fuseau local du navigateur", () => {\n    const timestamp = "2026-09-17T23:30:00-03:00";\n    const local = new Date(timestamp);\n    const pad = (value: number) => String(value).padStart(2, "0");\n    const expected = \`${"${pad(local.getDate())}-${pad(local.getMonth() + 1)}-${local.getFullYear()} ${pad(local.getHours())}:${pad(local.getMinutes())}"}\`;\n    expect(formatDateTimeForDisplay(timestamp)).toBe(expected);\n  });`;
replaceOrFail("web/src/lib/dates.contract.test.ts", oldWebTest, newWebTest);

const mobileTestPath = "Mobile/src/lib/dates.test.ts";
let mobileTest = read(mobileTestPath);
const oldMobileAssertion = `assert.match(formatDateTimeForDisplay("2026-09-17T14:35:00+02:00"), /^17-09-2026 14:35$/);`;
const newMobileAssertion = `const timestamp = "2026-09-17T23:30:00-03:00";\nconst localTimestamp = new Date(timestamp);\nconst padLocal = (value: number) => String(value).padStart(2, "0");\nconst expectedTimestamp = \`${"${padLocal(localTimestamp.getDate())}-${padLocal(localTimestamp.getMonth() + 1)}-${localTimestamp.getFullYear()} ${padLocal(localTimestamp.getHours())}:${padLocal(localTimestamp.getMinutes())}"}\`;\nassert.equal(formatDateTimeForDisplay(timestamp), expectedTimestamp);`;
if (!mobileTest.includes(newMobileAssertion)) {
  if (!mobileTest.includes(oldMobileAssertion)) throw new Error("mobile dates test: assertion timestamp introuvable");
  mobileTest = mobileTest.replace(oldMobileAssertion, newMobileAssertion);
  write(mobileTestPath, mobileTest);
}

// Extend the calendar component so migrated controls keep common input constraints and accessibility hooks.
const pickerPath = "web/src/components/ui/DatePicker.tsx";
let picker = read(pickerPath);
if (!picker.includes('"data-testid"?: string;')) {
  picker = picker.replace(
    `  placeholder?: string;\n  className?: string;\n}`,
    `  placeholder?: string;\n  className?: string;\n  min?: string;\n  max?: string;\n  autoFocus?: boolean;\n  "aria-invalid"?: boolean | "true" | "false";\n  "aria-describedby"?: string;\n  "data-testid"?: string;\n}`,
  );
  picker = picker.replace(
    `  placeholder = "JJ-MM-AAAA",\n  className = "",\n}: DatePickerProps) {`,
    `  placeholder = "JJ-MM-AAAA",\n  className = "",\n  min,\n  max,\n  autoFocus,\n  "aria-invalid": ariaInvalid,\n  "aria-describedby": ariaDescribedBy,\n  "data-testid": dataTestId,\n}: DatePickerProps) {`,
  );
  picker = picker.replace(
    `  function selectDay(day: number) {\n    onChange(toISO(viewYear, viewMonth, day));\n    setOpen(false);\n  }\n\n  function selectToday() {\n    onChange(toISO(today.getFullYear(), today.getMonth(), today.getDate()));\n    setOpen(false);\n  }`,
    `  function isAllowedDate(iso: string) {\n    return (!min || iso >= min) && (!max || iso <= max);\n  }\n\n  function selectDay(day: number) {\n    const next = toISO(viewYear, viewMonth, day);\n    if (!isAllowedDate(next)) return;\n    onChange(next);\n    setOpen(false);\n  }\n\n  function selectToday() {\n    const next = toISO(today.getFullYear(), today.getMonth(), today.getDate());\n    if (!isAllowedDate(next)) return;\n    onChange(next);\n    setOpen(false);\n  }`,
  );
  picker = picker.replace(
    `        onClick={openPicker}\n        disabled={disabled}\n        aria-haspopup="dialog"`,
    `        onClick={openPicker}\n        disabled={disabled}\n        autoFocus={autoFocus}\n        aria-invalid={ariaInvalid}\n        aria-describedby={ariaDescribedBy}\n        aria-required={required || undefined}\n        data-testid={dataTestId}\n        aria-haspopup="dialog"`,
  );
  picker = picker.replace(
    `                  const isSelected =\n                    selected?.y === viewYear && selected?.m === viewMonth && selected?.d === day;`,
    `                  const isoDay = toISO(viewYear, viewMonth, day);\n                  const isOutOfRange = !isAllowedDate(isoDay);\n                  const isSelected =\n                    selected?.y === viewYear && selected?.m === viewMonth && selected?.d === day;`,
  );
  picker = picker.replace(
    `                      onClick={() => selectDay(day)}\n                      className={\`flex h-9 items-center justify-center rounded-lg text-sm transition \${\n                        isSelected`,
    `                      onClick={() => selectDay(day)}\n                      disabled={isOutOfRange}\n                      className={\`flex h-9 items-center justify-center rounded-lg text-sm transition \${\n                        isOutOfRange\n                          ? "cursor-not-allowed opacity-40"\n                          : isSelected`,
  );
  picker = picker.replace(
    `                  onClick={selectToday}\n                  className="rounded-lg px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-50"`,
    `                  onClick={selectToday}\n                  disabled={!isAllowedDate(toISO(today.getFullYear(), today.getMonth(), today.getDate()))}\n                  className="rounded-lg px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-40"`,
  );
  write(pickerPath, picker);
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".tsx")) out.push(full);
  }
  return out;
}

let migrated = 0;
for (const file of walk(WEB_SRC)) {
  if (file === DATE_INPUT_PATH || file.endsWith(path.join("components", "ui", "DatePicker.tsx"))) continue;
  let source = fs.readFileSync(file, "utf8");
  let changed = false;
  source = source.replace(/<(Input|input)\b[\s\S]*?\/>/g, (match) => {
    if (!/\btype\s*=\s*["']date["']/.test(match)) return match;
    migrated += 1;
    changed = true;
    return match
      .replace(/^<(Input|input)\b/, "<DateInput")
      .replace(/\s+type\s*=\s*["']date["']/, "");
  });
  if (!changed) continue;
  const importPath = path
    .relative(path.dirname(file), DATE_INPUT_PATH.replace(/\.tsx$/, ""))
    .replaceAll(path.sep, "/");
  const specifier = importPath.startsWith(".") ? importPath : `./${importPath}`;
  if (!source.includes(`from "${specifier}"`) && !source.includes(`from '${specifier}'`)) {
    source = `import { DateInput } from "${specifier}";\n${source}`;
  }
  fs.writeFileSync(file, source, "utf8");
}

// StudentIdentityEditForm uses a local Field wrapper whose `type` was dynamic.
const identityPath = "web/src/components/students/editing/StudentIdentityEditForm.tsx";
let identity = read(identityPath);
if (identity.includes('type="date"')) {
  identity = identity.replace('        type="date"\n', '        date\n');
  identity = identity.replace('  type = "text",\n  required,', '  type = "text",\n  date = false,\n  required,');
  identity = identity.replace('  type?: string;\n  required?: boolean;', '  type?: string;\n  date?: boolean;\n  required?: boolean;');
  const oldInput = `      <input\n        id={id}\n        type={type}\n        className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"\n        value={value}\n        disabled={disabled}\n        required={required}\n        autoFocus={autoFocus}\n        aria-invalid={Boolean(error)}\n        aria-describedby={error ? \`${"${id}-error"}\` : undefined}\n        onChange={(event) => onChange(event.target.value)}\n      />`;
  const newInput = `      {date ? (\n        <DateInput\n          id={id}\n          className="mt-1"\n          value={value}\n          disabled={disabled}\n          required={required}\n          autoFocus={autoFocus}\n          aria-invalid={Boolean(error)}\n          aria-describedby={error ? \`${"${id}-error"}\` : undefined}\n          onChange={(event) => onChange(event.target.value)}\n        />\n      ) : (\n        <input\n          id={id}\n          type={type}\n          className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm"\n          value={value}\n          disabled={disabled}\n          required={required}\n          autoFocus={autoFocus}\n          aria-invalid={Boolean(error)}\n          aria-describedby={error ? \`${"${id}-error"}\` : undefined}\n          onChange={(event) => onChange(event.target.value)}\n        />\n      )}`;
  if (!identity.includes(oldInput)) throw new Error("StudentIdentityEditForm: input local introuvable");
  identity = identity.replace(oldInput, newInput);
  if (!identity.includes('import { DateInput }')) {
    identity = `import { DateInput } from "../../ui/DateInput";\n${identity}`;
  }
  write(identityPath, identity);
}

if (migrated !== 12) {
  throw new Error(`Nombre inattendu de contrôles date migrés: ${migrated} (attendu 12)`);
}

// P2: the audit must fail if any Web JSX still declares a literal type="date".
const auditPath = "scripts/audit-date-ui-contract.js";
let audit = read(auditPath);
audit = audit.replace(
  `    const source = fs.readFileSync(file, "utf8");\n    const isUi = target.uiSegments.some((segment) => relative.includes(\`/${"${segment}"}/\`));\n    const dateTerms = [...source.matchAll(DATE_NAME)].length;\n    const dateInputs = [...source.matchAll(/type\\s*=\\s*["']date["']/g)].length;`,
  `    const source = fs.readFileSync(file, "utf8");\n    const scanSource = source.replace(/\\/\\*[\\s\\S]*?\\*\\//g, "").replace(/\\/\\/.*$/gm, "");\n    const isUi = target.uiSegments.some((segment) => relative.includes(\`/${"${segment}"}/\`));\n    const dateTerms = [...source.matchAll(DATE_NAME)].length;\n    const dateInputs = target.platform === "Web" ? [...scanSource.matchAll(/type\\s*=\\s*["']date["']/g)].length : 0;`,
);
audit = audit.replace(
  `if (violations.length && !REPORT_ONLY) process.exitCode = 1;`,
  `if ((violations.length || nativeDateInputs.length) && !REPORT_ONLY) process.exitCode = 1;`,
);
write(auditPath, audit);

console.log(`date review feedback applied: migrated_web_date_controls=${migrated + 1}`);
