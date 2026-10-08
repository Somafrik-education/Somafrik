/**
 * CARTE-PR8 — transport NFC NDEF. Le métier reste runStudentCardScanFlow.
 * Le capability reste volatil. L’UID constate un tag, jamais un secret.
 * Aucun log, aucun stockage.
 */

export const CANONICAL_NFC_PERMISSION =
  "Somafrik utilise la puce NFC pour lire la carte élève de l’établissement.";

export const NFC_V1_PREFIX = "somafrik:card:";
export const MAX_NFC_RECORD_LENGTH = 256;

export const STUDENT_CARD_NFC_COPY = {
  button: "Scanner NFC",
  title: "Scanner une carte élève",
  subtitle: "Présentez la carte NFC près du téléphone.",
  unsupported: "NFC indisponible sur cet appareil.",
  disabled: "NFC désactivé sur cet appareil.",
  empty: "Carte illisible.",
  notNdef: "Cette carte n’est pas une carte élève Somafrik.",
  uidOnly: "Cette carte n’est pas une carte élève Somafrik.",
  invalidPrefix: "Cette carte n’est pas une carte élève Somafrik.",
  invalidToken: "Cette carte n’est pas une carte élève Somafrik.",
  cancelled: "Lecture NFC annulée.",
  error: "La lecture NFC n’a pas abouti.",
  retry: "Réessayer",
  useQr: "Utiliser QR",
  scanning: "Approchez la carte…",
  close: "Fermer",
} as const;

const BASE64URL_PART = /^[A-Za-z0-9_-]+$/;

export type NfcReadFailure =
  | "unsupported"
  | "disabled"
  | "empty"
  | "not_ndef"
  | "uid_only"
  | "invalid_prefix"
  | "invalid_token"
  | "cancelled"
  | "error";

export type NfcReadResult =
  | { ok: true; token: string }
  | { ok: false; reason: NfcReadFailure };

export type NfcHardware = {
  start(): Promise<void>;
  isSupported(): Promise<boolean>;
  isEnabled(): Promise<boolean>;
  requestTag(): Promise<void>;
  getTag(): Promise<{ ndefMessage?: unknown; id?: unknown; techTypes?: unknown } | null>;
  cancel(): Promise<void>;
};

export type NfcTagLike = {
  ndefMessage?: unknown;
  id?: unknown;
  techTypes?: unknown;
} | null | undefined;

export type NfcScannerReadDecision = {
  keepOpen: true;
  callOnClose: false;
  navigateHome: false;
  runAttendance: boolean;
  token: string | null;
  refusal: NfcReadFailure | null;
  message: string;
};

function tagHasDiscoveryHint(tag: Exclude<NfcTagLike, null | undefined>): boolean {
  if (tag.id) return true;
  return Array.isArray(tag.techTypes) && tag.techTypes.length > 0;
}

function bytesToString(bytes: number[] | Uint8Array | string): string {
  if (typeof bytes === "string") return bytes;
  return Array.from(bytes)
    .map((value) => String.fromCharCode(Number(value) & 0xff))
    .join("");
}

function recordTypeName(type: unknown): string {
  if (typeof type === "string") return type;
  if (Array.isArray(type) || type instanceof Uint8Array) {
    return bytesToString(type as number[] | Uint8Array);
  }
  return "";
}

function asByteArray(payload: unknown): number[] {
  if (Array.isArray(payload)) return payload.map((value) => Number(value) & 0xff);
  if (payload instanceof Uint8Array) return Array.from(payload);
  if (typeof payload === "string") {
    return Array.from(payload).map((char) => char.charCodeAt(0) & 0xff);
  }
  return [];
}

function decodeUriPayload(payload: number[]): string {
  if (!payload.length) return "";
  const prefixes: Record<number, string> = {
    0x00: "",
    0x01: "http://www.",
    0x02: "https://www.",
    0x03: "http://",
    0x04: "https://",
  };
  const code = payload[0] & 0xff;
  return `${prefixes[code] ?? ""}${bytesToString(payload.slice(1))}`;
}

function decodeTextPayload(payload: number[]): string {
  if (!payload.length) return "";
  const languageLength = payload[0] & 0x3f;
  return bytesToString(payload.slice(1 + languageLength));
}

export function decodeNdefRecordPayload(record: {
  type?: unknown;
  payload?: unknown;
} | null | undefined): string {
  if (!record) return "";
  const bytes = asByteArray(record.payload);
  const type = recordTypeName(record.type);
  if (type === "U" || type === "urn:nfc:wkt:U") return decodeUriPayload(bytes);
  if (type === "T" || type === "urn:nfc:wkt:T") return decodeTextPayload(bytes);
  return bytesToString(bytes).replace(/^\0+/, "").trim();
}

export function parseSomafrikCardToken(
  raw: unknown,
): { ok: true; token: string } | { ok: false; reason: "empty" | "invalid_prefix" | "invalid_token" } {
  const value = String(raw ?? "").trim();
  if (!value) return { ok: false, reason: "empty" };
  if (value.length > MAX_NFC_RECORD_LENGTH) return { ok: false, reason: "invalid_token" };
  if (
    value.startsWith("{")
    || value.startsWith("http://")
    || value.startsWith("https://")
    || /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  ) {
    return { ok: false, reason: "invalid_prefix" };
  }
  if (!value.startsWith(NFC_V1_PREFIX)) return { ok: false, reason: "invalid_prefix" };
  const token = value.slice(NFC_V1_PREFIX.length).trim();
  if (!token || token.length > MAX_NFC_RECORD_LENGTH) return { ok: false, reason: "invalid_token" };
  if (/\s/.test(token)) return { ok: false, reason: "invalid_token" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid_token" };
  if (!parts[0] || !parts[1]) return { ok: false, reason: "invalid_token" };
  if (!BASE64URL_PART.test(parts[0]) || !BASE64URL_PART.test(parts[1])) {
    return { ok: false, reason: "invalid_token" };
  }
  return { ok: true, token };
}

export function extractNfcCardTokenFromTag(tag: NfcTagLike): NfcReadResult {
  if (!tag) return { ok: false, reason: "empty" };
  const records = tag.ndefMessage;
  if (records == null) {
    return { ok: false, reason: tagHasDiscoveryHint(tag) ? "uid_only" : "not_ndef" };
  }
  if (!Array.isArray(records) || records.length === 0) return { ok: false, reason: "empty" };

  let sawInvalidToken = false;
  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    const decoded = decodeNdefRecordPayload(record as { type?: unknown; payload?: unknown });
    const parsed = parseSomafrikCardToken(decoded);
    if (parsed.ok) return parsed;
    if (parsed.reason === "invalid_token") sawInvalidToken = true;
  }
  return { ok: false, reason: sawInvalidToken ? "invalid_token" : "invalid_prefix" };
}

export function nfcFailureMessage(reason: NfcReadFailure): string {
  if (reason === "unsupported") return STUDENT_CARD_NFC_COPY.unsupported;
  if (reason === "disabled") return STUDENT_CARD_NFC_COPY.disabled;
  if (reason === "empty") return STUDENT_CARD_NFC_COPY.empty;
  if (reason === "not_ndef" || reason === "uid_only") return STUDENT_CARD_NFC_COPY.uidOnly;
  if (reason === "invalid_prefix" || reason === "invalid_token") {
    return STUDENT_CARD_NFC_COPY.invalidPrefix;
  }
  if (reason === "cancelled") return STUDENT_CARD_NFC_COPY.cancelled;
  return STUDENT_CARD_NFC_COPY.error;
}

export function shouldShowNfcQrFallback(input: {
  qrFallbackEnabled: boolean;
  failure?: NfcReadFailure | "";
  hasError?: boolean;
}): boolean {
  if (input.qrFallbackEnabled !== true) return false;
  return input.failure === "unsupported"
    || input.failure === "disabled"
    || input.hasError === true;
}

export function decideOpenQrFromNfcFallback(input: {
  canOpenQrScanner: boolean;
  authorReady: boolean;
}): boolean {
  return input.canOpenQrScanner === true && input.authorReady === true;
}

export function decideNfcScannerRead(read: NfcReadResult): NfcScannerReadDecision {
  if (read.ok) {
    return {
      keepOpen: true,
      callOnClose: false,
      navigateHome: false,
      runAttendance: true,
      token: read.token,
      refusal: null,
      message: "",
    };
  }
  return {
    keepOpen: true,
    callOnClose: false,
    navigateHome: false,
    runAttendance: false,
    token: null,
    refusal: read.reason,
    message: nfcFailureMessage(read.reason),
  };
}

export async function probeNfc(
  hardware: NfcHardware,
): Promise<{ status: "ready" | "unsupported" | "disabled" | "error" }> {
  try {
    if ((await hardware.isSupported()) !== true) return { status: "unsupported" };
    await hardware.start();
    if ((await hardware.isEnabled()) !== true) return { status: "disabled" };
    return { status: "ready" };
  } catch {
    return { status: "error" };
  }
}

export async function releaseNfcSession(hardware: NfcHardware): Promise<void> {
  try {
    await hardware.cancel();
  } catch {
    // already closed
  }
}

export async function scanNfcCardToken(hardware: NfcHardware): Promise<NfcReadResult> {
  try {
    const probe = await probeNfc(hardware);
    if (probe.status === "unsupported") return { ok: false, reason: "unsupported" };
    if (probe.status === "disabled") return { ok: false, reason: "disabled" };
    if (probe.status !== "ready") return { ok: false, reason: "error" };
    await hardware.requestTag();
    const tag = await hardware.getTag();
    return extractNfcCardTokenFromTag(tag);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/cancel/i.test(message)) return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "error" };
  } finally {
    await releaseNfcSession(hardware);
  }
}

export type NfcScannerForegroundDecision = {
  appActive: boolean;
  cancelSession: boolean;
  releaseToken: boolean;
  clearResult: boolean;
};

export function decideNfcScannerForeground(input: {
  nextAppState: string;
  visible: boolean;
}): NfcScannerForegroundDecision {
  if (input.nextAppState !== "active") {
    return {
      appActive: false,
      cancelSession: true,
      releaseToken: true,
      clearResult: true,
    };
  }
  return {
    appActive: true,
    cancelSession: false,
    releaseToken: false,
    clearResult: false,
  };
}
