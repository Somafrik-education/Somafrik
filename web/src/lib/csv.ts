type Row = Record<string, unknown>;

/** Échappe une valeur pour un champ CSV (RFC 4180). */
function escapeCsv(value: unknown): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n;]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

/** Sérialise des lignes en CSV à partir d'une liste de colonnes. */
export function rowsToCsv(
  rows: Row[],
  columns: { key: string; header: string }[],
): string {
  const header = columns.map((col) => escapeCsv(col.header)).join(",");
  const body = rows
    .map((row) => columns.map((col) => escapeCsv(row[col.key])).join(","))
    .join("\n");
  return `${header}\n${body}`;
}

/** Déclenche le téléchargement d'un contenu CSV. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`\ufeff${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** Analyse un texte CSV (séparateur , ou ;) en lignes de champs. */
function parseCsvLines(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  const delimiter = text.includes(";") && !text.includes(",") ? ";" : ",";

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * Convertit un CSV en objets clés/valeurs.
 * `headerMap` associe l'en-tête (normalisé) à la clé de champ cible.
 */
export function csvToObjects(
  text: string,
  headerMap: Record<string, string>,
): Row[] {
  const lines = parseCsvLines(text);
  if (lines.length < 2) return [];
  const headers = lines[0].map((cell) => cell.trim());
  return lines.slice(1).map((cells) => {
    const obj: Row = {};
    headers.forEach((header, index) => {
      const key = headerMap[header.toLowerCase()] ?? headerMap[header] ?? null;
      if (key) {
        obj[key] = (cells[index] ?? "").trim();
      }
    });
    return obj;
  });
}
