"use strict";

/**
 * Identifiant de connexion métier — égalité exacte uniquement.
 * Aucun alias ENS/ELE/ETU, aucune séquence 0001/00001, aucun {school}-{alias}.
 */
class AccountIdentifier {
  constructor(schoolCode, identifier) {
    this.schoolCode = String(schoolCode ?? "").trim().toUpperCase();
    this.raw = String(identifier ?? "").trim();
    this.upper = this.raw.toUpperCase();
  }

  matches(value) {
    const normalizedValue = String(value ?? "").trim().toUpperCase();
    return Boolean(this.upper) && normalizedValue === this.upper;
  }

  isAdmin() {
    return this.raw.toLowerCase() === "admin";
  }
}

module.exports = { AccountIdentifier };
