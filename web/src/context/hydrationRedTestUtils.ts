/** Helpers for sync/hydration RED tests. No production behaviour. */

export const SCHOOL_ID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const SCHOOL_ID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
export const SCHOOL_A = "CD-IN-26-001";
export const SCHOOL_B = "BI-EC-26-001";
export const API = "http://localhost:5000/api";

export function collapseCounts(history: number[]): string {
  const collapsed: number[] = [];
  for (const value of history) {
    if (collapsed.length === 0 || collapsed[collapsed.length - 1] !== value) {
      collapsed.push(value);
    }
  }
  return collapsed.join(" → ");
}

export function neverDippedToZero(history: number[]): boolean {
  let seenPositive = false;
  for (const value of history) {
    if (value > 0) seenPositive = true;
    if (seenPositive && value === 0) return false;
  }
  return true;
}

export function deferred() {
  let resolve!: () => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function pgStudent(index: number, schoolCode = SCHOOL_A, schoolId = SCHOOL_ID_A) {
  const seq = String(index + 1).padStart(5, "0");
  const prefix = schoolCode.slice(0, 2);
  return {
    id: `${prefix}-IN-EL-26-${seq}`,
    publicId: `${prefix}-IN-EL-26-${seq}`,
    studentCode: `${prefix}-IN-EL-26-${seq}`,
    firstName: `Prenom${index + 1}`,
    lastName: `Nom${index + 1}`,
    name: `Prenom${index + 1} Nom${index + 1}`,
    className: "6ème A",
    schoolId,
    schoolCode,
    schoolPublicCode: schoolCode,
    status: "active",
  };
}

export function pgUser(index: number, schoolCode = SCHOOL_A, schoolId = SCHOOL_ID_A) {
  return {
    id: `user-${schoolCode}-${index + 1}`,
    firstName: `User${index + 1}`,
    lastName: "Admin",
    role: "Admin School",
    schoolId,
    schoolCode,
    schoolPublicCode: schoolCode,
  };
}

export function pgSchool(code: string, id: string, name: string) {
  return {
    id,
    code,
    name,
    countryCode: code.slice(0, 2),
    status: "active",
  };
}

export function pathnameOf(url: string) {
  const href = String(url);
  const stripped = href.startsWith(API) ? href.slice(API.length) : href;
  return stripped.split("?")[0] ?? stripped;
}

export function authHeader(init?: RequestInit) {
  const headers = init?.headers as Record<string, string> | undefined;
  if (!headers) return "";
  return headers.Authorization ?? headers.authorization ?? "";
}
