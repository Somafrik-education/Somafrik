/**
 * NFC-PRES-LOCAL-PR4 — transmission des appels clôturés hors connexion (contrat PR0 §6, route PR1c).
 *
 * Aucune seconde machine d'état : chaque tentative passe par les fonctions PR2
 * `listSyncCandidates` → `beginSyncAttempt` (COMMIT de `syncing`, corps figé) → envoi du corps
 * figé À L'IDENTIQUE (`Idempotency-Key = operationId`) → `recordSyncOutcome` (décision
 * `decideSyncOutcome`, purge des preuves uniquement dans la transaction qui écrit `synced`).
 *
 * Garanties :
 *  - un seul envoi à la fois par runner ; les déclencheurs simultanés sont regroupés ;
 *  - le corps envoyé est la chaîne lue dans la base, jamais recalculée ni re-sérialisée ;
 *  - une réponse n'est appliquée qu'à la base du compte qui a envoyé, et seulement si cette base
 *    est toujours ouverte pour ce compte : sinon la session reste `syncing` et sera reprise en
 *    `failed_retryable` / INTERRUPTED (renvoi identique) à la prochaine ouverture du même compte ;
 *  - l'en-tête `Date` alimente `recordTrustedTime` (monotone : jamais de recul) ;
 *  - backoff borné, écrit avec le résultat (`next_attempt_at`) ; échéance jamais prolongée.
 * Aucun journal ne contient de preuve, de corps ou d'identifiant : seulement des codes.
 */
import { recordTrustedTime } from "../store/accountManager";
import {
  beginSyncAttempt,
  decideSyncOutcome,
  listSyncCandidates,
  recordSyncOutcome,
  type RcContext,
  type RcSessionRow,
  type SyncDecision,
  type SyncOutcome,
} from "../store/repository";

export type SyncTransportResult =
  | { kind: "network"; code: "TIMEOUT" | "NETWORK" }
  | { kind: "http"; status: number; body: unknown; dateHeader: string | null };

/** Envoi HTTP : `body` est transmis octet pour octet, `operationId` en Idempotency-Key. */
export type SyncTransport = (input: { operationId: string; body: string }) => Promise<SyncTransportResult>;

export type SyncTrigger = "closed" | "online" | "resume" | "login" | "timer" | "manual";

export type SyncRunReport = {
  trigger: SyncTrigger;
  attempted: number;
  synced: number;
  retryable: number;
  actionRequired: number;
  unconfirmable: number;
  /** Réponses non appliquées : compte déconnecté ou changé pendant l'envoi. */
  isolated: number;
  skipped?: "no_account" | "stopped";
};

/** Délais bornés après un échec temporaire (tentative n → index n − 1), plafond 1 h. */
export const RC_RETRY_DELAYS_MS = [30_000, 120_000, 300_000, 900_000, 1_800_000, 3_600_000] as const;
/** Refus d'accès (401/403/404) : on attend un rétablissement, sans insister. */
export const RC_UNCONFIRMABLE_DELAY_MS = 900_000;

export function nextAttemptDelayMs(decision: SyncDecision, attempt: number, random: () => number = Math.random): number | null {
  if (decision.state === "failed_retryable") {
    const base = RC_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1), RC_RETRY_DELAYS_MS.length) - 1];
    // ±10 % pour ne pas synchroniser tous les téléphones d'un établissement à la même seconde.
    return Math.round(base * (0.9 + 0.2 * Math.min(Math.max(random(), 0), 1)));
  }
  if (decision.state === "unconfirmable") return Math.max(RC_UNCONFIRMABLE_DELAY_MS, RC_RETRY_DELAYS_MS[Math.min(Math.max(attempt, 1), RC_RETRY_DELAYS_MS.length) - 1]);
  return null; // synced ou intervention : aucune tentative automatique
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * Réponse HTTP → issue PR2. Un ACK n'est transmis que s'il est un objet ; tout ACK incomplet ou
 * contradictoire est jugé par `decideSyncOutcome` (jamais `synced`).
 */
export function toSyncOutcome(result: SyncTransportResult): SyncOutcome {
  if (result.kind === "network") return { kind: "network" };
  const body = result.body && typeof result.body === "object" && !Array.isArray(result.body) ? (result.body as Record<string, unknown>) : null;
  if (result.status >= 200 && result.status < 300) {
    if (!body) return { kind: "http", httpStatus: result.status, ack: null };
    // ACK strict : sessionId obligatoire, sinon contradiction (jamais d'ACK d'une autre session).
    const ack = {
      operationId: body.operationId,
      revision: body.revision,
      payloadDigest: body.payloadDigest,
      sessionId: typeof body.sessionId === "string" && UUID.test(body.sessionId) ? body.sessionId : "MISSING",
      rollCallId: body.rollCallId,
      counts: body.counts,
    };
    return { kind: "http", httpStatus: result.status, ack };
  }
  const code = typeof body?.code === "string" && CODE.test(body.code) ? body.code : null;
  const sessionState = body?.sessionState === "not_recorded" || body?.sessionState === "conflict" ? body.sessionState : null;
  return { kind: "http", httpStatus: result.status, errorCode: code, sessionState };
}

export type SyncAccount = { ctx: RcContext };

export type SyncRunnerDeps = {
  /** Base ouverte du compte authentifié courant (null : aucun envoi). */
  currentAccount: () => SyncAccount | null;
  transport: SyncTransport;
  random?: () => number;
  log?: (event: string, code?: string) => void;
  /** Appelé après chaque transition enregistrée (actualisation de l'interface). */
  onChange?: () => void;
};

export function createRollCallSyncRunner(deps: SyncRunnerDeps) {
  const log = deps.log ?? (() => undefined);
  let epoch = 0;
  let running: Promise<SyncRunReport> | null = null;
  let queued: { trigger: SyncTrigger; ignoreBackoff: boolean } | null = null;

  async function runOnce(trigger: SyncTrigger, ignoreBackoff: boolean): Promise<SyncRunReport> {
    const report: SyncRunReport = { trigger, attempted: 0, synced: 0, retryable: 0, actionRequired: 0, unconfirmable: 0, isolated: 0 };
    const account = deps.currentAccount();
    if (!account) return { ...report, skipped: "no_account" };
    const myEpoch = epoch;
    const ctx = account.ctx;
    const stillMine = () => epoch === myEpoch && deps.currentAccount()?.ctx === ctx;

    let candidates: RcSessionRow[];
    try {
      candidates = await listSyncCandidates(ctx, { ignoreBackoff });
    } catch (error) {
      log("rc_sync_list_failed", codeOf(error));
      return report;
    }
    for (const session of candidates) {
      if (!stillMine()) return { ...report, skipped: "stopped" };
      let attempt: { operationId: string; frozenBody: string; attempt: number };
      try {
        attempt = await beginSyncAttempt(ctx, session.session_id);
      } catch (error) {
        log("rc_sync_begin_refused", codeOf(error)); // état changé entre-temps : rien envoyé
        continue;
      }
      report.attempted += 1;
      deps.onChange?.();
      let result: SyncTransportResult;
      try {
        result = await deps.transport({ operationId: attempt.operationId, body: attempt.frozenBody });
      } catch {
        result = { kind: "network", code: "NETWORK" };
      }
      // Compte déconnecté, changé ou base fermée pendant l'envoi : réponse jamais appliquée.
      if (!stillMine()) {
        report.isolated += 1;
        log("rc_sync_response_isolated");
        return { ...report, skipped: "stopped" };
      }
      if (result.kind === "http" && result.dateHeader) {
        const serverMs = Date.parse(result.dateHeader);
        if (Number.isFinite(serverMs)) await recordTrustedTime(ctx, serverMs).catch((error) => log("rc_trusted_time_refused", codeOf(error)));
      }
      const outcome = toSyncOutcome(result);
      let decision: SyncDecision;
      try {
        decision = await recordSyncOutcome(ctx, session.session_id, attempt.operationId, outcome, {
          nextAttemptAt: (planned, n) => {
            const delay = nextAttemptDelayMs(planned, n, deps.random);
            return delay === null ? null : new Date(ctx.nowMs() + delay).toISOString();
          },
        });
      } catch (error) {
        // Base fermée entre la réponse et l'écriture : la session reste `syncing`, reprise idempotente.
        report.isolated += 1;
        log("rc_sync_record_failed", codeOf(error));
        return report;
      }
      deps.onChange?.();
      if (decision.state === "synced") report.synced += 1;
      else if (decision.state === "failed_retryable") report.retryable += 1;
      else if (decision.state === "unconfirmable") report.unconfirmable += 1;
      else report.actionRequired += 1;
      log("rc_sync_outcome", decision.errorCode ?? decision.state.toUpperCase());
      // Réseau absent ou accès refusé : inutile d'insister sur les appels suivants dans ce passage.
      if (outcome.kind === "network" || decision.state === "unconfirmable") break;
    }
    return report;
  }

  return {
    /**
     * Lance un passage. Si un passage est en cours, la demande est mise en file (un seul passage
     * supplémentaire, avec l'option la plus large) : jamais deux envois concurrents d'une base.
     */
    run(input: { trigger: SyncTrigger; ignoreBackoff?: boolean }): Promise<SyncRunReport> {
      // Événements qui changent les conditions (demande explicite, réseau retrouvé, retour du même
      // compte) : tentative immédiate. Minuterie et reprise respectent le backoff. L'échéance J+3
      // s'applique toujours.
      const ignoreBackoff = input.trigger === "manual" || input.trigger === "online" || input.trigger === "login" || input.ignoreBackoff === true;
      if (running) {
        queued = { trigger: input.trigger, ignoreBackoff: ignoreBackoff || (queued?.ignoreBackoff ?? false) };
        return running; // le passage en cours traite la file avant de se terminer
      }
      const loop = async (): Promise<SyncRunReport> => {
        let last = await runOnce(input.trigger, ignoreBackoff);
        while (queued) {
          const next = queued;
          queued = null;
          last = await runOnce(next.trigger, next.ignoreBackoff);
        }
        return last;
      };
      running = loop().finally(() => {
        running = null;
      });
      return running;
    },
    /** Déconnexion, changement de compte : plus aucun envoi, aucune réponse en vol appliquée. */
    stop() {
      epoch += 1;
      queued = null;
    },
    busy: () => running !== null,
  };
}

export type RollCallSyncRunner = ReturnType<typeof createRollCallSyncRunner>;

/** Pure : décision attendue pour une session (utilisée par l'interface et les tests). */
export function predictDecision(session: RcSessionRow, result: SyncTransportResult): SyncDecision {
  return decideSyncOutcome(session, toSyncOutcome(result));
}

function codeOf(error: unknown): string {
  const code = (error as { code?: unknown })?.code;
  return typeof code === "string" && CODE.test(code) ? code : "UNKNOWN";
}
