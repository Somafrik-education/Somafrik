/**
 * NFC-PRES-LOCAL-PR2 — gate S13 : parité cryptographique Mobile / Backend.
 *
 * Fonction pure, sans API Node : la même suite s'exécute sous Node (tests unitaires) et sous
 * Hermes dans l'APK (entrée de recette `App.rcHermesParity.tsx`). Les vecteurs sont lus tels quels
 * dans docs/audits/NFC-PRES-LOCAL-PR0-vectors.json (oracle Backend) et dans
 * docs/audits/NFC-PRES-LOCAL-PR2-vectors.json (liste de révocation signée, calculée par le Backend).
 *
 * Les résultats ne contiennent que des identifiants de cas, des empreintes et des booléens :
 * aucune donnée réelle, aucun secret (les vecteurs sont fictifs et à faible entropie).
 */
import { bytesToHex } from "./bytes";
import { utf8 as utf8Encode } from "../jcs";
import {
  canonicalJson,
  computeCardRef,
  computePayloadDigest,
  computeProof,
  computeVerifier,
  deriveCardKeyFromSecret,
  lp,
  packSigningMessage,
  revocationsSigningMessage,
  sha256,
  verifyEd25519,
} from "./primitives";

export type ParityCase = { id: string; ok: boolean; detail: string };
export type ParityReport = { engine: string; total: number; passed: number; failed: string[]; cases: ParityCase[] };

type Vectors = {
  inputs: Record<string, string>;
  expected: Record<string, unknown>;
  testPack: Record<string, unknown>;
  testSyncBodyWithoutDigest: Record<string, unknown>;
  jcs: Record<string, { input?: unknown; canonical?: string; sha256?: string }>;
};

type Pr2Vectors = {
  revocations: {
    publicKey: string;
    list: Record<string, unknown>;
    signature: { alg: string; keyId: string; value: string };
    canonicalSha256: string;
  };
};

function sha256Hex(text: string): string {
  return bytesToHex(sha256(utf8Encode(text)));
}

function refuses(fn: () => unknown): boolean {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Nom du moteur JavaScript courant ("hermes" sous l'APK, "node" sous les tests). */
export function detectEngine(): string {
  const global = globalThis as { HermesInternal?: unknown; process?: { versions?: { node?: string } } };
  if (global.HermesInternal) return "hermes";
  if (global.process?.versions?.node) return `node-${global.process.versions.node}`;
  return "unknown";
}

export function runRollCallParitySuite(vectors: Vectors, pr2: Pr2Vectors): ParityReport {
  const cases: ParityCase[] = [];
  const check = (id: string, run: () => [boolean, string]) => {
    try {
      const [ok, detail] = run();
      cases.push({ id, ok, detail });
    } catch (error) {
      cases.push({ id, ok: false, detail: `exception:${(error as Error)?.name ?? "Error"}` });
    }
  };
  const input = vectors.inputs;
  const expected = vectors.expected;

  // JCS J-1 à J-7 : même chaîne canonique et même SHA-256 des octets UTF-8 que jcs.js.
  for (const id of ["J-1", "J-2", "J-3", "J-4", "J-5", "J-6", "J-7"]) {
    check(id, () => {
      const vector = vectors.jcs[id];
      const canonical = canonicalJson(vector.input);
      const digest = sha256Hex(canonical);
      return [canonical === vector.canonical && digest === vector.sha256, digest];
    });
  }
  // Refus J-8 à J-11 (construits en code : non représentables en JSON).
  check("J-8", () => [refuses(() => canonicalJson({ v: -0 })), "-0 refusé"]);
  check("J-9", () => [refuses(() => canonicalJson({ v: 0.1 })) && refuses(() => canonicalJson({ w: 1e21 })), "flottants refusés"]);
  check("J-10", () => [refuses(() => canonicalJson({ a: undefined, b: 1 })), "undefined refusé"]);
  check("J-11", () => [
    refuses(() => canonicalJson({ v: "\ud800" })) && refuses(() => lp(["\ud800"])) && refuses(() => utf8Encode("\udc00")),
    "surrogate isolé refusé (JCS, LP, UTF-8)",
  ]);

  // LP V-6 / V-7.
  check("V-6", () => {
    const left = bytesToHex(lp(["a|b", "c"]));
    const right = bytesToHex(lp(["a", "b|c"]));
    return [left === expected["V-6_lp_a|b,c"] && right === expected["V-6_lp_a,b|c"] && left !== right, `${left}/${right}`];
  });
  check("V-7", () => {
    const hex = bytesToHex(lp(["ab", "", "c"]));
    return [hex === expected["V-7_lp_ab,empty,c"], hex];
  });

  // K, cardRef, verifier, preuves V-1 à V-5 et V-8.
  const key = deriveCardKeyFromSecret(input.secret);
  const scope = { schoolId: input.schoolId, classId: input.classId, packId: input.packId, publicId: input.publicId };
  const proofInput = {
    ...scope,
    contractVersion: input.contractVersion,
    actorUserId: input.actorUserId,
    date: input.date,
    mode: input.mode,
    sessionId: input.sessionId,
    scanId: input.scanId,
  };
  check("V-1", () => {
    const hex = bytesToHex(key);
    return [hex === expected["V-1_K_hex"], "K"];
  });
  check("V-2", () => {
    const value = computeCardRef(scope);
    return [value === expected["V-2_cardRef"], value];
  });
  check("V-3", () => {
    const value = computeVerifier(key, scope);
    return [value === expected["V-3_verifier"], value];
  });
  check("V-4", () => {
    const value = computeProof(key, { ...proofInput, medium: "nfc" });
    return [value === expected["V-4_proof_nfc"], value];
  });
  check("V-5", () => {
    const value = computeProof(key, { ...proofInput, medium: "qr" });
    return [value === expected["V-5_proof_qr"] && value !== expected["V-4_proof_nfc"], value];
  });
  check("V-8", () => {
    const value = computeProof(key, { ...proofInput, packId: "", medium: "nfc" });
    return [value === expected["V-8_proof_nfc_noPack"], value];
  });

  // Pack de test : JCS identique, signature Ed25519 V-9 / V-10, altération détectée.
  check("PACK-JCS", () => {
    const digest = sha256Hex(canonicalJson(vectors.testPack));
    return [digest === expected["V-10_pack_canonical_sha256"], digest];
  });
  check("V-9/V-10", () => {
    const ok = verifyEd25519(expected["V-10_pack_signature"], packSigningMessage(vectors.testPack), expected["V-9_ed25519_test_pub_raw"]);
    return [ok === true && expected["V-10_verifies"] === true, `verifies=${ok}`];
  });
  check("V-10-TAMPERED", () => {
    const tampered = { ...clone(vectors.testPack), classId: "00000000-0000-4000-8000-000000000009" };
    const ok = verifyEd25519(expected["V-10_pack_signature"], packSigningMessage(tampered), expected["V-9_ed25519_test_pub_raw"]);
    return [ok === false && expected["V-10_tampered_classId_verifies"] === false, `verifies=${ok}`];
  });

  // Lot de synchronisation : payloadDigest V-11 / V-12.
  check("V-11", () => {
    const digest = computePayloadDigest(vectors.testSyncBodyWithoutDigest);
    return [digest === expected["V-11_payloadDigest"], digest];
  });
  check("V-11-IGNORES-DIGEST-FIELD", () => {
    const digest = computePayloadDigest({ ...clone(vectors.testSyncBodyWithoutDigest), payloadDigest: "x" });
    return [digest === expected["V-11_payloadDigest"], digest];
  });
  check("V-12", () => {
    const body = clone(vectors.testSyncBodyWithoutDigest) as { scans: Array<Record<string, unknown>> };
    body.scans[0].medium = "qr";
    const digest = computePayloadDigest(body as unknown as Record<string, unknown>);
    return [digest === expected["V-12_payloadDigest_medium_qr"] && digest !== expected["V-11_payloadDigest"], digest];
  });

  // Liste de révocation signée par le Backend (PR1b) : message exact et signature.
  check("REVOCATIONS-JCS", () => {
    const digest = sha256Hex(canonicalJson(pr2.revocations.list));
    return [digest === pr2.revocations.canonicalSha256, digest];
  });
  check("REVOCATIONS-SIGNATURE", () => {
    const ok = verifyEd25519(pr2.revocations.signature.value, revocationsSigningMessage(pr2.revocations.list), pr2.revocations.publicKey);
    const tampered = verifyEd25519(
      pr2.revocations.signature.value,
      revocationsSigningMessage({ ...clone(pr2.revocations.list), sequence: 0 }),
      pr2.revocations.publicKey,
    );
    const crossTag = verifyEd25519(pr2.revocations.signature.value, packSigningMessage(pr2.revocations.list), pr2.revocations.publicKey);
    return [ok && !tampered && !crossTag, `verifies=${ok} tampered=${tampered} crossTag=${crossTag}`];
  });

  const failed = cases.filter((entry) => !entry.ok).map((entry) => entry.id);
  return { engine: detectEngine(), total: cases.length, passed: cases.length - failed.length, failed, cases };
}
