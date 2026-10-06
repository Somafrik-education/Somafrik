import { useEffect, useState } from "react";
import { Button, Card, InlineAlert, SectionHeader } from "../../design-system";
import { ApiError } from "../../api/client";
import { useOptionalActiveSchool } from "../../context/ActiveSchoolContext";
import { schoolSettingsApi, type SchoolSettings } from "../../lib/schoolSettingsApi";
import {
  STUDENT_CARD_FINANCE_NOTICE,
  isStudentCardMasterEnabled,
} from "../../lib/studentCardPolicy";
import { hasBackOfficePermission } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

type CardSettingsDraft = {
  studentCardEnabled: boolean;
  studentCardQrEnabled: boolean;
  studentCardNfcEnabled: boolean;
  studentCardAttendanceEnabled: boolean;
  studentCardFinanceCheckEnabled: boolean;
};

function draftFromSettings(settings: SchoolSettings): CardSettingsDraft {
  return {
    studentCardEnabled: settings.studentCardEnabled === true,
    studentCardQrEnabled: settings.studentCardQrEnabled === true,
    studentCardNfcEnabled: settings.studentCardNfcEnabled === true,
    studentCardAttendanceEnabled: settings.studentCardAttendanceEnabled === true,
    studentCardFinanceCheckEnabled: settings.studentCardFinanceCheckEnabled === true,
  };
}

export function StudentCardSettingsSection() {
  const school = useOptionalActiveSchool();
  const schoolCode = String(school?.activeSchoolCode ?? "").trim();
  if (!school || !schoolCode || schoolCode === "*") return null;
  return <StudentCardSettingsForm schoolCode={schoolCode} />;
}

function StudentCardSettingsForm({ schoolCode }: { schoolCode: string }) {
  const permissionCtx = usePermissionContext();
  const canUpdate = hasBackOfficePermission(permissionCtx, "Paramètres Établissement", "UPDATE");
  const [draft, setDraft] = useState<CardSettingsDraft | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDraft(null);
    void schoolSettingsApi
      .get(schoolCode)
      .then((settings) => {
        if (!cancelled) setDraft(draftFromSettings(settings));
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

  const masterOn = draft ? isStudentCardMasterEnabled({ studentCardEnabled: draft.studentCardEnabled }) : false;

  async function save() {
    if (!draft || !canUpdate) return;
    setPending(true);
    setNotice(null);
    try {
      const saved = await schoolSettingsApi.patch(
        {
          studentCardEnabled: draft.studentCardEnabled,
          studentCardQrEnabled: draft.studentCardQrEnabled,
          studentCardNfcEnabled: draft.studentCardNfcEnabled,
          studentCardAttendanceEnabled: draft.studentCardAttendanceEnabled,
          studentCardFinanceCheckEnabled: draft.studentCardFinanceCheckEnabled,
        },
        schoolCode,
      );
      setDraft(draftFromSettings(saved));
      setNotice("Paramètres de carte enregistrés. Les cartes déjà émises ne sont pas modifiées.");
    } catch (error) {
      setNotice(error instanceof ApiError ? "Enregistrement refusé." : "Enregistrement impossible.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <SectionHeader
        title="Carte élève"
        description="Activation de la carte, du QR, du NFC et des contrôles associés. Aucun accès matériel NFC n’est ouvert ici."
      />
      {failed ? (
        <InlineAlert tone="danger" title="Paramètres indisponibles">
          Les paramètres de carte élève n’ont pas pu être lus. Aucune modification n’est proposée.
        </InlineAlert>
      ) : null}
      {!draft && !failed ? <p className="text-sm text-muted">Chargement des paramètres de carte…</p> : null}
      {draft ? (
        <fieldset className="space-y-3" disabled={!canUpdate || pending}>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.studentCardEnabled}
              onChange={(event) =>
                setDraft({ ...draft, studentCardEnabled: event.target.checked })
              }
            />
            Carte élève activée
          </label>
          <div className="space-y-2 ps-1">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.studentCardQrEnabled}
                disabled={!masterOn}
                onChange={(event) =>
                  setDraft({ ...draft, studentCardQrEnabled: event.target.checked })
                }
              />
              QR
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.studentCardNfcEnabled}
                disabled={!masterOn}
                onChange={(event) =>
                  setDraft({ ...draft, studentCardNfcEnabled: event.target.checked })
                }
              />
              NFC
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.studentCardAttendanceEnabled}
                disabled={!masterOn}
                onChange={(event) =>
                  setDraft({ ...draft, studentCardAttendanceEnabled: event.target.checked })
                }
              />
              Pointage présence
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={draft.studentCardFinanceCheckEnabled}
                disabled={!masterOn}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    studentCardFinanceCheckEnabled: event.target.checked,
                  })
                }
              />
              Contrôle financier informatif
            </label>
          </div>
          {!masterOn ? (
            <p className="text-sm text-muted">Le master désactivé neutralise le QR, le NFC, le pointage et le contrôle financier.</p>
          ) : null}
          <p className="text-sm text-muted">{STUDENT_CARD_FINANCE_NOTICE}</p>
          <p className="text-sm text-muted">Le Web ne programme pas la puce NFC et ne lit aucun badge.</p>
        </fieldset>
      ) : null}
      {notice ? <p className="text-sm text-ink">{notice}</p> : null}
      {draft && canUpdate ? (
        <Button type="button" onClick={() => void save()} disabled={pending}>
          Enregistrer la carte élève
        </Button>
      ) : null}
    </Card>
  );
}
