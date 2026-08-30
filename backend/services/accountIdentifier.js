class AccountIdentifier {
  constructor(schoolCode, identifier) {
    this.schoolCode = String(schoolCode ?? "").trim().toUpperCase();
    this.raw = String(identifier ?? "").trim();
    this.upper = this.raw.toUpperCase();
    this.values = this.buildValues();
  }

  matches(value) {
    const normalizedValue = String(value ?? "").trim().toUpperCase();

    if (!normalizedValue) {
      return false;
    }

    if (this.values.includes(normalizedValue) || this.values.includes(String(value).trim())) {
      return true;
    }

    const localMatch = AccountIdentifier.parseLocalIdentifier(normalizedValue);

    if (!localMatch) {
      return false;
    }

    return AccountIdentifier.buildAliases(this.schoolCode, localMatch.profile, localMatch.sequence).some((alias) =>
      this.values.includes(alias)
    );
  }

  isAdmin() {
    return this.raw.toLowerCase() === "admin";
  }

  buildValues() {
    const values = new Set([this.raw, this.upper]);
    const localMatch = AccountIdentifier.parseLocalIdentifier(this.upper);

    if (localMatch) {
      AccountIdentifier.buildAliases(this.schoolCode, localMatch.profile, localMatch.sequence).forEach((alias) =>
        values.add(alias)
      );
    }

    return [...values];
  }

  static parseLocalIdentifier() {
    return null;
  }

  static buildAliases(schoolCode, profile, sequence) {
    const profiles = AccountIdentifier.getProfileAliases(profile);
    const sequences = [...new Set([
      String(Number(sequence)),
      AccountIdentifier.formatSequence(sequence, 4),
      AccountIdentifier.formatSequence(sequence, 5),
      AccountIdentifier.formatSequence(sequence, 6),
    ])];
    const aliases = [];

    profiles.forEach((profileAlias) => {
      sequences.forEach((formattedSequence) => {
        const localIdentifier = `${profileAlias}-${formattedSequence}`;
        aliases.push(localIdentifier);
        aliases.push(`${schoolCode}-${localIdentifier}`);
      });
    });

    return aliases;
  }

  static getProfileAliases(profile) {
    const normalizedProfile = String(profile ?? "").trim().toUpperCase();

    if (["ELE", "ETU"].includes(normalizedProfile)) {
      return ["ELE", "ETU"];
    }

    return ["ENS"];
  }

  static formatSequence(sequence, size) {
    return String(Number(sequence)).padStart(size, "0");
  }
}

module.exports = { AccountIdentifier };
