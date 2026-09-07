"use strict";

function roleLabel(role) {
  const labels = {
    chef_etablissement: "Chef d'établissement",
    promoteur: "Promoteur",
    directeur: "Directeur",
    administrateur: "Administrateur",
  };
  return labels[role] || role;
}

function expectedText(fields) {
  return [
    "Nouvelle demande d'essai Somafrik",
    `Référence : ${fields.publicRef}`,
    `Nom du demandeur : ${fields.requesterName}`,
    `Rôle : ${roleLabel(fields.role)}`,
    `Établissement : ${fields.schoolName}`,
    `Pays : ${fields.countryIso}`,
    `Ville : ${fields.city}`,
    `Téléphone / WhatsApp : ${fields.phone}`,
    `E-mail : ${fields.email}`,
    `Effectif approximatif : ${fields.studentBand}`,
    "",
    "Aucun établissement, utilisateur ni abonnement n'a été créé automatiquement.",
  ].join("\n");
}

module.exports = {
  TRIAL_REQUEST_NOTIFY_TO: "contact@somafrik.app",
  EXPECTED_TRIAL_REQUEST_EMAIL: {
    subject: (schoolName) => `[Somafrik] Nouvelle demande d'essai — ${schoolName}`,
    text: expectedText,
  },
};
