"use strict";

const nodemailer = require("nodemailer");
const {
  TRIAL_REQUEST_NOTIFY_TO,
  EXPECTED_TRIAL_REQUEST_EMAIL,
} = require("./trialAccessRequestNotification.emailCopy");

function notifyTo() {
  const configured = String(process.env.TRIAL_REQUEST_NOTIFY_TO || "").trim();
  return configured || TRIAL_REQUEST_NOTIFY_TO;
}

function buildTrialRequestNotificationEmail(request = {}) {
  return {
    to: notifyTo(),
    subject: EXPECTED_TRIAL_REQUEST_EMAIL.subject(request.schoolName),
    text: EXPECTED_TRIAL_REQUEST_EMAIL.text(request),
  };
}

function smtpConfigured() {
  return Boolean(
    String(process.env.SMTP_HOST || "").trim() && String(process.env.MAIL_FROM || "").trim(),
  );
}

function createTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  const user = String(process.env.SMTP_USER || "").trim();
  const options = {
    host: process.env.SMTP_HOST,
    port,
    secure,
  };
  if (user) {
    options.auth = {
      user,
      pass: process.env.SMTP_PASSWORD || "",
    };
  }
  return nodemailer.createTransport(options);
}

async function notifyTrialAccessRequest(request = {}) {
  const mail = buildTrialRequestNotificationEmail(request);
  if (!smtpConfigured()) {
    console.warn(
      `[trial-request] notification not sent: SMTP_HOST or MAIL_FROM missing (publicRef=${request.publicRef || ""})`,
    );
    return { skipped: true, reason: "smtp_not_configured" };
  }
  const transporter = createTransport();
  await transporter.sendMail({
    from: process.env.MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  });
  return { skipped: false };
}

module.exports = {
  buildTrialRequestNotificationEmail,
  notifyTrialAccessRequest,
  TRIAL_REQUEST_NOTIFY_TO,
};
