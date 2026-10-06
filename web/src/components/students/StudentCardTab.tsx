import { useCallback, useEffect, useState } from "react";
import { Button, InlineAlert, Modal } from "../../design-system";
import { ApiError } from "../../api/client";
import { useOptionalActiveSchool } from "../../context/ActiveSchoolContext";
import { formatDateForDisplay } from "../../lib/dates";
import { schoolSettingsApi } from "../../lib/schoolSettingsApi";
import {
  studentCardsApi,
  type IssuedStudentAccessCard,
  type StudentAccessCard,
} from "../../lib/studentCardsApi";
import {
  STUDENT_CARD_MASTER_OFF_NOTICE,
  STUDENT_CARD_NFC_ONLY_NOTICE,
  STUDENT_CARD_REPRINT_NOTICE,
  STUDENT_CARD_SETTINGS_UNAVAILABLE_NOTICE,
  buildStudentCardPrintIdentity,
  resolveStudentCardSettingsGate,
  studentCardActions,
  studentCardErrorMessage,
  studentCardMediumLabel,
  studentCardStatusLabel,
  type StudentCardAction,
  type StudentCardSettingsGate,
} from "../../lib/studentCardPolicy";
import type { SchoolStudent } from "../../lib/studentsApi";
import type { StudentWorkspaceViewModel } from "../../lib/studentWorkspaceViewModel";
import { StudentCardIssueDialog } from "./StudentCardIssueDialog";
import { StudentCardPrintView } from "./StudentCardPrintView";

interface StudentCardTabProps {
  workspace: StudentWorkspaceViewModel;
  dossier?: SchoolStudent | null;
  canManage: boolean;
  schoolCode?: string;
}

interface PreviewState {
  cardToken: string;
  publicId: string;
}

interface PendingAction {
  card: StudentAccessCard;
  action: StudentCardAction;
}

const ACTION_COPY: Record<StudentCardAction, { title: string; description: string; confirm: string }> = {
  lost: {
    title: "Déclarer perdue",
    description: "Cette carte deviendra immédiatement inutilisable.",
    confirm: "Déclarer perdue",
  },
  revoke: {
    title: "Révoquer",
    description: "Cette révocation est définitive. La carte n’est pas supprimée.",
    confirm: "Révoquer",
  },
  replace: {
    title: "Remplacer la carte",
    description: "Le remplacement invalidera définitivement l’ancienne carte et générera un nouveau QR sécurisé.",
    confirm: "Remplacer",
  },
};

function formatIssuedAt(value: string | null | undefined): string {
  return formatDateForDisplay(value) || "Date non renseignée";
}

export function StudentCardTab({
  workspace,
  dossier,
  canManage,
  schoolCode,
}: StudentCardTabProps) {
  const activeSchool = useOptionalActiveSchool();
  const resolvedSchoolCode = String(
    schoolCode ?? (activeSchool?.activeSchoolCode === "*" ? "" : activeSchool?.activeSchoolCode ?? ""),
  ).trim();
  const [gate, setGate] = useState<StudentCardSettingsGate>({ state: "unavailable" });
  const [cards, setCards] = useState<StudentAccessCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [issueOpen, setIssueOpen] = useState(false);
  const [pendingIssue, setPendingIssue] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const reloadCards = useCallback(async () => {
    const listed = await studentCardsApi.list(workspace.studentId);
    setCards(Array.isArray(listed.cards) ? listed.cards : []);
  }, [workspace.studentId]);

  useEffect(() => {
    setPreview(null);
  }, [workspace.studentId]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setNotice(null);
      if (!resolvedSchoolCode) {
        if (!cancelled) {
          setGate({ state: "unavailable" });
          setCards([]);
          setLoading(false);
        }
        return;
      }
      try {
        const settings = await schoolSettingsApi.get(resolvedSchoolCode);
        if (cancelled) return;
        const nextGate = resolveStudentCardSettingsGate(settings);
        setGate(nextGate);
        if (nextGate.state !== "ready") {
          setCards([]);
          return;
        }
        await reloadCards();
      } catch {
        if (!cancelled) {
          setGate({ state: "unavailable" });
          setCards([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [reloadCards, resolvedSchoolCode]);

  const readyMedium = gate.state === "ready" ? gate.medium : null;
  const hasActiveCard = cards.some((card) => card.status === "active");

  async function issueCard() {
    if (!readyMedium || pendingIssue) return;
    setPendingIssue(true);
    setNotice(null);
    try {
      const issued = await studentCardsApi.issue(workspace.studentId, readyMedium);
      setPreview({ cardToken: issued.cardToken, publicId: issued.publicId });
      setIssueOpen(false);
      await reloadCards();
    } catch (error) {
      if (error instanceof ApiError && error.code === "STUDENT_CARD_ACTIVE_ALREADY_EXISTS") {
        await reloadCards().catch(() => undefined);
      }
      setNotice(studentCardErrorMessage(error));
    } finally {
      setPendingIssue(false);
    }
  }

  async function confirmAction() {
    if (!pendingAction || actionBusy) return;
    setActionBusy(true);
    setNotice(null);
    try {
      if (pendingAction.action === "lost") {
        await studentCardsApi.markLost(pendingAction.card.id);
      } else if (pendingAction.action === "revoke") {
        await studentCardsApi.revoke(pendingAction.card.id);
      } else {
        const replaced = await studentCardsApi.replace(pendingAction.card.id);
        const card: IssuedStudentAccessCard = replaced.card;
        setPreview({ cardToken: card.cardToken, publicId: card.publicId });
      }
      setPendingAction(null);
      await reloadCards();
    } catch (error) {
      setNotice(studentCardErrorMessage(error));
      if (error instanceof ApiError && error.code === "STUDENT_CARD_INVALID_STATE") {
        await reloadCards().catch(() => undefined);
      }
    } finally {
      setActionBusy(false);
    }
  }

  function closePreview() {
    setPreview(null);
    void reloadCards().catch(() => undefined);
  }

  const printIdentity = preview
    ? buildStudentCardPrintIdentity({
        displayName: workspace.displayName,
        classLabel: workspace.classLabel,
        studentCode: dossier?.studentCode || workspace.matriculeLabel,
        schoolName: workspace.schoolNameLabel,
        photoUrl: dossier?.photoUrl ?? null,
        publicId: preview.publicId,
      })
    : null;

  return (
    <div className="space-y-6" data-testid="student-card-tab">
      {loading ? <p className="text-sm text-muted">Chargement des cartes…</p> : null}
      {!loading && gate.state === "disabled" ? (
        <InlineAlert tone="info" title="Carte élève">
          {STUDENT_CARD_MASTER_OFF_NOTICE}
        </InlineAlert>
      ) : null}
      {!loading && gate.state === "unavailable" ? (
        <InlineAlert tone="danger" title="Carte élève">
          {STUDENT_CARD_SETTINGS_UNAVAILABLE_NOTICE}
        </InlineAlert>
      ) : null}
      {!loading && gate.state === "ready" ? (
        <>
          {preview && printIdentity ? (
            <StudentCardPrintView
              cardToken={preview.cardToken}
              identity={printIdentity}
              school={activeSchool?.activeSchool ?? null}
              onClose={closePreview}
            />
          ) : (
            <p className="text-sm text-muted">{STUDENT_CARD_REPRINT_NOTICE}</p>
          )}
          {notice ? (
            <InlineAlert tone="danger" title="Carte élève">
              {notice}
            </InlineAlert>
          ) : null}
          {gate.nfcOnly ? <p className="text-sm text-ink">{STUDENT_CARD_NFC_ONLY_NOTICE}</p> : null}
          {!gate.nfcOnly && !readyMedium ? (
            <p className="text-sm text-ink">Aucune émission n’est possible sans activer le QR.</p>
          ) : null}
          {!hasActiveCard ? <p className="text-sm font-medium text-ink">Aucune carte élève active.</p> : null}
          {canManage && readyMedium ? (
            <Button type="button" onClick={() => setIssueOpen(true)}>
              Émettre une carte
            </Button>
          ) : null}
          <ul className="space-y-3">
            {cards.map((card) => {
              const actions = canManage ? studentCardActions(card.status) : [];
              return (
                <li key={card.id}>
                  <article className="space-y-2 rounded-xl border border-line p-4" aria-label={`Carte ${card.publicId}`}>
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">{studentCardStatusLabel(card.status)}</p>
                      <p className="text-xs text-muted">{studentCardMediumLabel(card.medium)}</p>
                    </div>
                    <p className="text-sm">ID carte : {card.publicId}</p>
                    <p className="text-sm text-muted">Émise le {formatIssuedAt(card.issuedAt)}</p>
                    {card.revokeReason ? <p className="text-sm text-muted">Motif : {card.revokeReason}</p> : null}
                    {actions.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {actions.includes("lost") ? (
                          <Button type="button" variant="secondary" onClick={() => setPendingAction({ card, action: "lost" })}>
                            Déclarer perdue
                          </Button>
                        ) : null}
                        {actions.includes("revoke") ? (
                          <Button type="button" variant="danger" onClick={() => setPendingAction({ card, action: "revoke" })}>
                            Révoquer
                          </Button>
                        ) : null}
                        {actions.includes("replace") ? (
                          <Button type="button" variant="secondary" onClick={() => setPendingAction({ card, action: "replace" })}>
                            Remplacer
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </article>
                </li>
              );
            })}
          </ul>
          {readyMedium ? (
            <StudentCardIssueDialog
              open={issueOpen}
              medium={readyMedium}
              pending={pendingIssue}
              onCancel={() => setIssueOpen(false)}
              onConfirm={() => void issueCard()}
            />
          ) : null}
          <Modal
            open={pendingAction !== null}
            title={pendingAction ? ACTION_COPY[pendingAction.action].title : ""}
            description={pendingAction ? ACTION_COPY[pendingAction.action].description : undefined}
            onClose={() => {
              if (!actionBusy) setPendingAction(null);
            }}
            footer={
              <>
                <Button type="button" variant="secondary" disabled={actionBusy} onClick={() => setPendingAction(null)}>
                  Annuler
                </Button>
                <Button type="button" disabled={actionBusy} onClick={() => void confirmAction()}>
                  {pendingAction ? ACTION_COPY[pendingAction.action].confirm : "Confirmer"}
                </Button>
              </>
            }
          >
            <p className="text-sm text-muted">La liste des cartes sera relue depuis le serveur.</p>
          </Modal>
        </>
      ) : null}
    </div>
  );
}
