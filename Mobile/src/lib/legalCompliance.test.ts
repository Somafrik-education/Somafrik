import assert from "node:assert/strict";
import { ACCOUNT_DELETION_URL, LEGAL_COPY, PRIVACY_POLICY_URL } from "./legalCompliance";

assert.equal(PRIVACY_POLICY_URL, "https://somafrik.app/confidentialite");
assert.equal(ACCOUNT_DELETION_URL, "https://somafrik.app/suppression-compte");
assert.match(LEGAL_COPY.privacy, /confidentialité/i);
assert.match(LEGAL_COPY.deletion, /suppression/i);
assert.notEqual(PRIVACY_POLICY_URL, ACCOUNT_DELETION_URL);

console.log("OK: liens légaux Mobile publics, HTTPS et distincts");
