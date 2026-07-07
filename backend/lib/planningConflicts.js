"use strict";

/**
 * Moteur de détection de conflits de planning (côté backend / filet de sécurité).
 *
 * Porte la logique métier du web (`web/src/lib/coursePlanning.ts`) suffisamment
 * pour refuser à la persistance toute double réservation introduite par une
 * requête : chevauchement d'un même enseignant, ou d'une même classe, sur des
 * créneaux qui se recouvrent (jour + heure) au sein d'une période commune.
 *
 * La comparaison se fait en UTC pour être indépendante du fuseau du serveur :
 * deux créneaux stockés avec la même convention se comparent de façon cohérente.
 */

function normalizeLabel(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Parse une date période « JJ-MM-AAAA » (ou « JJMMAAAA ») en Date UTC (minuit). */
function parsePeriodDate(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  let day;
  let month;
  let year;

  const dashed = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashed) {
    day = Number(dashed[1]);
    month = Number(dashed[2]);
    year = Number(dashed[3]);
  } else if (/^\d{8}$/.test(raw)) {
    day = Number(raw.slice(0, 2));
    month = Number(raw.slice(2, 4));
    year = Number(raw.slice(4, 8));
  } else {
    return null;
  }

  if (!day || !month || !year) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}

function isExam(slot) {
  return String(slot?.kind ?? "") === "exam";
}

function hasPeriod(slot) {
  return Boolean(String(slot?.periodStart ?? "").trim() && String(slot?.periodEnd ?? "").trim());
}

function weekdayUTC(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? -1 : date.getUTCDay();
}

function minutesOfDay(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return -1;
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

/** Les plages de dates de période se recouvrent-elles (inclusif) ? */
function periodsOverlap(a, b) {
  const aStart = parsePeriodDate(a.periodStart);
  const aEnd = parsePeriodDate(a.periodEnd);
  const bStart = parsePeriodDate(b.periodStart);
  const bEnd = parsePeriodDate(b.periodEnd);
  // Si une période manque, on reste conservateur : on considère qu'elles se recouvrent.
  if (!aStart || !aEnd || !bStart || !bEnd) return true;
  return aStart.getTime() <= bEnd.getTime() && aEnd.getTime() >= bStart.getTime();
}

/** Deux créneaux se recouvrent-ils dans le temps ? (gère cours récurrent / examen) */
function slotsTimeOverlap(a, b) {
  const aStart = minutesOfDay(a.start);
  const aEnd = minutesOfDay(a.end);
  const bStart = minutesOfDay(b.start);
  const bEnd = minutesOfDay(b.end);
  if (aStart < 0 || aEnd < 0 || bStart < 0 || bEnd < 0) return false;

  const aExam = isExam(a);
  const bExam = isExam(b);

  if (aExam && bExam) {
    // Examens : chevauchement absolu (même jour calendaire) + plage horaire.
    const sameDay =
      new Date(a.start).toISOString().slice(0, 10) ===
      new Date(b.start).toISOString().slice(0, 10);
    return sameDay && timeRangesOverlap(aStart, aEnd, bStart, bEnd);
  }

  if (!aExam && !bExam) {
    // Cours récurrents : même jour de semaine + plage horaire + périodes qui se recouvrent.
    if (weekdayUTC(a.start) !== weekdayUTC(b.start)) return false;
    if (!periodsOverlap(a, b)) return false;
    return timeRangesOverlap(aStart, aEnd, bStart, bEnd);
  }

  // Mixte cours ↔ examen : l'examen tombe-t-il dans une occurrence du cours ?
  const course = aExam ? b : a;
  const exam = aExam ? a : b;
  if (weekdayUTC(course.start) !== weekdayUTC(exam.start)) return false;
  const examDay = parsePeriodDate(
    (() => {
      const d = new Date(exam.start);
      if (Number.isNaN(d.getTime())) return "";
      const pad = (n) => String(n).padStart(2, "0");
      return `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}`;
    })(),
  );
  const pStart = parsePeriodDate(course.periodStart);
  const pEnd = parsePeriodDate(course.periodEnd);
  if (examDay && pStart && pEnd) {
    if (examDay.getTime() < pStart.getTime() || examDay.getTime() > pEnd.getTime()) return false;
  }
  return timeRangesOverlap(aStart, aEnd, bStart, bEnd);
}

function timeLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

/** Messages de conflit entre deux créneaux, ou [] si aucun. */
function conflictMessages(a, b) {
  if (!a || !b) return [];
  if (normalizeLabel(a.schoolCode) !== normalizeLabel(b.schoolCode)) return [];
  if (!slotsTimeOverlap(a, b)) return [];

  const messages = [];
  const when = `${timeLabel(b.start)}–${timeLabel(b.end)}`;

  if (a.teacherId && b.teacherId && String(a.teacherId) === String(b.teacherId)) {
    const teacher = b.teacherName ? ` ${b.teacherName}` : "";
    messages.push(
      `Conflit enseignant${teacher} : déjà « ${b.subject} » (${b.className}) ${when}.`,
    );
  }
  if (normalizeLabel(a.className) && normalizeLabel(a.className) === normalizeLabel(b.className)) {
    messages.push(`Conflit sur ${b.className} : « ${b.subject} » ${when}.`);
  }

  return messages;
}

/**
 * Détecte les conflits *introduits* par les créneaux modifiés (`changedIds`).
 * On ne valide que le delta pour ne jamais bloquer une sauvegarde à cause de
 * données historiques déjà incohérentes.
 *
 * @returns {{ slotId: string, message: string }[]}
 */
function detectIntroducedConflicts(slots, changedIds) {
  const list = Array.isArray(slots) ? slots.filter(Boolean) : [];
  const changed = new Set((changedIds ?? []).map((id) => String(id)));
  if (!changed.size) return [];

  const issues = [];
  const seen = new Set();

  for (const candidate of list) {
    if (!changed.has(String(candidate.id))) continue;
    for (const other of list) {
      if (String(other.id) === String(candidate.id)) continue;
      for (const message of conflictMessages(candidate, other)) {
        const key = `${candidate.id}|${message}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ slotId: String(candidate.id), message });
      }
    }
  }

  return issues;
}

/** Signature d'un créneau : sert à repérer les lignes réellement modifiées. */
function scheduleSignature(slot) {
  return [
    slot?.schoolCode ?? "",
    slot?.className ?? "",
    slot?.subject ?? "",
    slot?.teacherId ?? "",
    slot?.start ?? "",
    slot?.end ?? "",
    slot?.kind ?? "",
    slot?.periodStart ?? "",
    slot?.periodEnd ?? "",
  ].join("|");
}

/** Ids des créneaux ajoutés ou modifiés entre deux états. */
function changedScheduleIds(previousSlots, nextSlots) {
  const prev = new Map(
    (Array.isArray(previousSlots) ? previousSlots : [])
      .filter(Boolean)
      .map((slot) => [String(slot.id), scheduleSignature(slot)]),
  );
  return (Array.isArray(nextSlots) ? nextSlots : [])
    .filter(Boolean)
    .filter((slot) => prev.get(String(slot.id)) !== scheduleSignature(slot))
    .map((slot) => String(slot.id));
}

module.exports = {
  normalizeLabel,
  parsePeriodDate,
  conflictMessages,
  detectIntroducedConflicts,
  scheduleSignature,
  changedScheduleIds,
};
