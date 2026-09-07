"use strict";

const { isSuperAdminPrincipal } = require("./platformManagement");

/** Raccord d'activation : Standard complet + 30 jours d'essai, pas d'offre d'essai limitée. */
const TRIAL_ACTIVATION_OFFER_ID = "OFFER-STANDARD";
const TRIAL_ACTIVATION_OPTIONS = { startTrial: true };

function createHttpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function asTrimmed(value) {
  return String(value ?? "").trim();
}

async function createTrialAccessRequest(repo, payload = {}, options = {}) {
  if (!payload.consent) {
    throw createHttpError(400, "Le consentement est obligatoire.");
  }
  if (asTrimmed(payload.website)) {
    return { id: "honeypot", publicRef: "TRIAL-0", status: "nouvelle" };
  }

  const email = asTrimmed(payload.email);
  const schoolName = asTrimmed(payload.schoolName);

  if (typeof repo.findOpenTrialRequest === "function") {
    const existing = await repo.findOpenTrialRequest(email, schoolName);
    if (existing) {
      throw createHttpError(409, "Une demande d'essai est déjà en cours pour cet établissement.");
    }
  }

  const row = {
    requesterName: asTrimmed(payload.requesterName),
    role: asTrimmed(payload.role),
    schoolName,
    countryIso: asTrimmed(payload.countryIso).toUpperCase(),
    city: asTrimmed(payload.city),
    phone: asTrimmed(payload.phone),
    email,
    studentBand: asTrimmed(payload.studentBand),
    consent: true,
    consentAt: new Date().toISOString(),
    status: "nouvelle",
  };

  const created = await repo.createTrialAccessRequest(row);
  const notify =
    typeof options.notifyTrialRequest === "function"
      ? options.notifyTrialRequest
      : require("./trialAccessRequestNotification").notifyTrialAccessRequest;
  try {
    await notify(created);
  } catch (error) {
    console.error(
      `[trial-request] notification failed (publicRef=${created.publicRef || ""}):`,
      error && error.message ? error.message : error,
    );
  }
  return created;
}

async function listTrialAccessRequests(repo, principal) {
  if (!principal) {
    throw createHttpError(401, "Authentification requise.");
  }
  if (!isSuperAdminPrincipal(principal)) {
    throw createHttpError(403, "Accès réservé au Superadmin.");
  }
  if (Array.isArray(repo.rows)) {
    return repo.rows;
  }
  if (typeof repo.listTrialAccessRequests === "function") {
    return repo.listTrialAccessRequests();
  }
  return [];
}

module.exports = {
  createTrialAccessRequest,
  listTrialAccessRequests,
  TRIAL_ACTIVATION_OFFER_ID,
  TRIAL_ACTIVATION_OPTIONS,
};
