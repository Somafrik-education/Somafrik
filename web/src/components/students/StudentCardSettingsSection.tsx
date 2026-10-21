import { useEffect, useState } from "react";
import { Button, Card, InlineAlert, SectionHeader } from "../../design-system";
import { ApiError } from "../../api/client";
import { useOptionalActiveSchool } from "../../context/ActiveSchoolContext";
import { schoolSettingsApi, type SchoolSettings } from "../../lib/schoolSettingsApi";
import { educationReferenceApi, type EducationLevel } from "../../lib/educationReferenceApi";
import {
  STUDENT_CARD_FINANCE_NOTICE,
  STUDENT_CARD_HOLDER_LABELS,
  isStudentCardMasterEnabled,
  type StudentCardHolderKind,
} from "../../lib/studentCardPolicy";
import { hasBackOfficePermission } from "../../lib/permissions";
import { usePermissionContext } from "../../lib/usePermissionContext";

type CardSettingsDraft = {
  studentCardEnabled: boolean;
  studentCardQrEnabled: boolean;
  studentCardNfcEnabled: boolean;
  studentCardAttendanceEnabled: boolean;
  studentCardFinanceCheckEnabled: boolean;
  /** CARTE-CYCLE-01 — "" = automatique (type d'établissement exact). */
  studentCardHolderKind: StudentCardHolderKind | "";
  studentCardHolderLevels: Record<string, StudentCardHolderKind>;
  studentCardHolderFromSchoolType: StudentCardHolderKind | null;
};

const HOLDER_KINDS: StudentCardHolderKind[] = ["eleve", "etudiant"];

function asHolderKind(value: unknown): StudentCardHolderKind | null {
  return value === "eleve" || value === "etudiant" ? value : null;
}

function draftFromSettings(settings: SchoolSettings): CardSettingsDraft {
  const levels: Record<string, StudentCardHolderKind> = {};
  for (const [levelId, kind] of Object.entries(settings.studentCardHolderLevels ?? {})) {
    const normalized = asHolderKind(kind);
    if (normalized) levels[levelId] = normalized;
  }
  return {
    studentCardHolderKind: asHolderKind(settings.studentCardHolderKind) ?? "",
    studentCardHolderLevels: levels,
    studentCardHolderFromSchoolType: asHolderKind(settings.studentCardHolderFromSchoolType),
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
  /** Niveaux actifs de l'établissement ; null = liste indisponible (surcharges non modifiables). */
  const [levels, setLevels] = useState<EducationLevel[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLevels(null);
    void educationReferenceApi
      .getSchoolCatalog(schoolCode)
      .then((catalog) => {
        if (!cancelled) setLevels((catalog.levels ?? []).filter((level) => level.schoolActive === true));
      })
      .catch(() => {
        if (!cancelled) setLevels(null);
      });
    return () => {
      cancelled = true;
    };
  }, [schoolCode]);

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
          studentCardHolderKind: draft.studentCardHolderKind || null,
          // Remplacement complet, limité aux niveaux actifs affichés ; omis si la liste est indisponible.
          ...(levels
            ? {
                studentCardHolderLevels: Object.fromEntries(
                  levels
                    .filter((level) => draft.studentCardHolderLevels[level.id])
                    .map((level) => [level.id, draft.studentCardHolderLevels[level.id]]),
                ),
              }
            : {}),
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
          <fieldset className="space-y-2 border-t border-line pt-3" aria-describedby="student-card-holder-help">
            <legend className="text-sm font-semibold text-ink">Titulaire de la carte</legend>
            <p id="student-card-holder-help" className="text-sm text-muted">
              Détermine l’en-tête « Carte d’élève » ou « Carte d’étudiant ». Sans titulaire déterminé, aucune carte ne peut être
              émise ni remplacée. Les cartes existantes ne sont pas modifiées.
            </p>
            <label className="block text-sm" htmlFor="student-card-holder-kind">
              Pour tout l’établissement
            </label>
            <select
              id="student-card-holder-kind"
              className="rounded-md border border-line px-2 py-1 text-sm"
              value={draft.studentCardHolderKind}
              onChange={(event) =>
                setDraft({ ...draft, studentCardHolderKind: asHolderKind(event.target.value) ?? "" })
              }
            >
              <option value="">
                {draft.studentCardHolderFromSchoolType
                  ? `Automatique selon le type d’établissement : ${STUDENT_CARD_HOLDER_LABELS[draft.studentCardHolderFromSchoolType]}`
                  : "Automatique : type d’établissement non déterminant (à préciser)"}
              </option>
              {HOLDER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {STUDENT_CARD_HOLDER_LABELS[kind]}
                </option>
              ))}
            </select>
            {!draft.studentCardHolderKind && !draft.studentCardHolderFromSchoolType ? (
              <p className="text-sm text-amber" role="status">
                Titulaire non déterminé : choisissez « Élève » ou « Étudiant », ou configurez chaque niveau ci-dessous.
              </p>
            ) : null}
            {levels === null ? (
              <p className="text-sm text-muted">Les niveaux d’enseignement n’ont pas pu être lus : le réglage par niveau est indisponible.</p>
            ) : levels.length > 0 ? (
              <div className="space-y-2">
                <p className="text-sm text-ink">Établissement mixte : titulaire par niveau d’enseignement</p>
                {levels.map((level) => (
                  <div key={level.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <label htmlFor={`student-card-holder-level-${level.id}`} className="min-w-40">
                      {level.name}
                    </label>
                    <select
                      id={`student-card-holder-level-${level.id}`}
                      className="rounded-md border border-line px-2 py-1 text-sm"
                      value={draft.studentCardHolderLevels[level.id] ?? ""}
                      onChange={(event) => {
                        const next = { ...draft.studentCardHolderLevels };
                        const kind = asHolderKind(event.target.value);
                        if (kind) next[level.id] = kind;
                        else delete next[level.id];
                        setDraft({ ...draft, studentCardHolderLevels: next });
                      }}
                    >
                      <option value="">Comme l’établissement</option>
                      {HOLDER_KINDS.map((kind) => (
                        <option key={kind} value={kind}>
                          {STUDENT_CARD_HOLDER_LABELS[kind]}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>
            ) : null}
          </fieldset>
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
