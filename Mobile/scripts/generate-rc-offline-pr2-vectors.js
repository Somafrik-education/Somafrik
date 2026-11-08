/**
 * NFC-PRES-LOCAL-PR2 — vecteurs complémentaires calculés par le Backend (oracle).
 *
 *   node Mobile/scripts/generate-rc-offline-pr2-vectors.js          # écrit le fichier
 *   node Mobile/scripts/generate-rc-offline-pr2-vectors.js --check  # échoue si le fichier diverge
 *
 * Clé de TEST uniquement : graine Ed25519 = 32 octets 0x01 (même clé que V-9 du contrat PR0).
 * Les octets signés sont produits par backend/lib/rollCallOfflineProof.js (revocationsSigningMessage),
 * la signature par node:crypto, exactement comme le signataire PR1b.
 */
"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { canonicalJson, revocationsSigningMessage, CONTRACT_VERSION } = require("../../backend/lib/rollCallOfflineProof");

const OUTPUT = path.resolve(__dirname, "../../docs/audits/NFC-PRES-LOCAL-PR2-vectors.json");
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

function build() {
  const seed = Buffer.alloc(32, 1);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: "der", type: "pkcs8" });
  const publicKey = crypto.createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12).toString("base64url");
  const list = {
    contractVersion: CONTRACT_VERSION,
    sequence: 3,
    revokedKeyIds: ["rc-pack-test-0", "rc-pack-test-2"],
    issuedAt: "2026-11-08T16:02:00Z",
  };
  const signature = crypto.sign(null, revocationsSigningMessage(list), privateKey).toString("base64url");
  return {
    _note:
      "NFC-PRES-LOCAL-PR2 — vecteurs FICTIFS calculés par le Backend (rollCallOfflineProof.js + node:crypto). Clé de TEST : graine 32 × 0x01 (V-9). Aucune valeur réelle.",
    generator: "Mobile/scripts/generate-rc-offline-pr2-vectors.js",
    revocations: {
      keyId: "rc-pack-test-1",
      publicKey,
      list,
      signature: { alg: "Ed25519", keyId: "rc-pack-test-1", value: signature },
      canonicalSha256: crypto.createHash("sha256").update(canonicalJson(list), "utf8").digest("hex"),
    },
  };
}

const text = `${JSON.stringify(build(), null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.readFileSync(OUTPUT, "utf8");
  if (current !== text) {
    console.error("NFC-PRES-LOCAL-PR2-vectors.json diverge du calcul Backend.");
    process.exit(1);
  }
  console.log("OK: NFC-PRES-LOCAL-PR2-vectors.json reproduit par le Backend");
} else {
  fs.writeFileSync(OUTPUT, text);
  console.log(`écrit: ${path.relative(process.cwd(), OUTPUT)}`);
}
