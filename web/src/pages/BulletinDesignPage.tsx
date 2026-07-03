import { useCallback, useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { useActiveSchool } from "../context/ActiveSchoolContext";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Input, Select } from "../components/ui/Field";
import { useToast } from "../components/ui/Toast";
import { isSuperAdminRole } from "../lib/orgHierarchy";
import { normalize } from "../lib/format";
import { formatSchoolOption } from "../lib/superadminCrudPath";
import { Navigate } from "react-router-dom";
import { getSuperAdminHomePath } from "../lib/superAdminAccess";
import {
  defaultBulletinClassDesign,
  listClassNamesForSchool,
  listSubjectsForClass,
  readBulletinDesignByClass,
  type BulletinClassDesign,
} from "../lib/bulletinDesign";
import {
  BulletinGrapesEditor,
  type BulletinEditorExport,
} from "../components/bulletin/BulletinGrapesEditor";

export function BulletinDesignPage() {
  const { session } = useAuth();
  const { state, update } = useData();
  const { showToast } = useToast();
  const { availableSchools, setActiveSchoolCode } = useActiveSchool();
  const user = session?.user ?? null;

  const [schoolCode, setSchoolCode] = useState(() => availableSchools[0]?.code ?? "");
  const [className, setClassName] = useState("");
  const [draft, setDraft] = useState<BulletinClassDesign | null>(null);
  const [saving, setSaving] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const designKey = `${schoolCode}::${className}`;

  useEffect(() => {
    if (!schoolCode && availableSchools[0]?.code) {
      setSchoolCode(availableSchools[0].code);
    }
  }, [availableSchools, schoolCode]);

  useEffect(() => {
    if (schoolCode) setActiveSchoolCode(schoolCode);
  }, [schoolCode, setActiveSchoolCode]);

  const classNames = useMemo(
    () => (schoolCode ? listClassNamesForSchool(user, state, schoolCode) : []),
    [user, state, schoolCode],
  );

  const subjects = useMemo(
    () => (schoolCode && className ? listSubjectsForClass(state, schoolCode, className, user) : []),
    [state, schoolCode, className, user],
  );

  useEffect(() => {
    if (!className && classNames.length) {
      setClassName(classNames[0]);
    } else if (className && !classNames.includes(className)) {
      setClassName(classNames[0] ?? "");
    }
  }, [classNames, className]);

  useEffect(() => {
    if (!schoolCode || !className) {
      setDraft(null);
      return;
    }
    const config = (state.academicConfigs?.[schoolCode] ?? {}) as Record<string, unknown>;
    setDraft(readBulletinDesignByClass(config, className, subjects));
  }, [schoolCode, className, subjects, state.academicConfigs]);

  const school = availableSchools.find((item) => normalize(item.code) === normalize(schoolCode)) ?? null;

  const handleEditorExport = useCallback((payload: BulletinEditorExport) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            htmlTemplate: payload.htmlTemplate,
            cssTemplate: payload.cssTemplate,
            grapesProject: payload.grapesProject,
          }
        : current,
    );
  }, []);

  function toggleSubject(subject: string) {
    if (!draft) return;
    const enabled = new Set(draft.enabledSubjects);
    if (enabled.has(subject)) enabled.delete(subject);
    else enabled.add(subject);
    setDraft({ ...draft, enabledSubjects: [...enabled] });
  }

  async function saveDesign() {
    if (!schoolCode || !className || !draft) return;
    setSaving(true);
    try {
      const currentConfig = (state.academicConfigs?.[schoolCode] ?? {}) as Record<string, unknown>;
      const currentDesigns = (
        currentConfig.bulletinDesignByClass && typeof currentConfig.bulletinDesignByClass === "object"
          ? { ...(currentConfig.bulletinDesignByClass as Record<string, BulletinClassDesign>) }
          : {}
      ) as Record<string, BulletinClassDesign>;

      await update(
        {
          academicConfigs: {
            [schoolCode]: {
              ...currentConfig,
              schoolCode,
              bulletinDesignByClass: {
                ...currentDesigns,
                [className]: { ...draft, templateVersion: 1 },
              },
            },
          },
        },
        { partial: true },
      );
      showToast(`Modèle bulletin enregistré — ${className}`, "success");
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Échec de l'enregistrement du modèle";
      showToast(message, "error");
    } finally {
      setSaving(false);
    }
  }

  async function previewDesign(format: "html" | "pdf") {
    if (!schoolCode || !className || !draft) return;
    if (format === "html") setPreviewing(true);
    else setDownloadingPdf(true);
    try {
      const blob = await api.postBlob(
        `/backoffice/bulletin-design/preview?format=${format}`,
        { schoolCode, className, design: draft },
      );
      const mime = format === "pdf" ? "application/pdf" : "text/html;charset=utf-8";
      const url = URL.createObjectURL(new Blob([blob], { type: mime }));
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : "Échec de la génération de l'aperçu";
      showToast(message, "error");
    } finally {
      setPreviewing(false);
      setDownloadingPdf(false);
    }
  }

  function resetDesign() {
    if (!className) return;
    setDraft(defaultBulletinClassDesign(className, subjects));
  }

  if (!isSuperAdminRole(user?.role)) {
    return <Navigate to={getSuperAdminHomePath()} replace />;
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-br from-slate-800 to-brand p-6 text-white">
        <p className="text-sm font-semibold text-white/75">Conception bulletins</p>
        <h2 className="mt-2 text-2xl font-black">Éditeur visuel GrapesJS</h2>
        <p className="mt-2 max-w-3xl text-sm text-white/85">
          GrapesJS → modèle HTML/CSS → calcul des notes (backend) → insertion données élève → QR code
          → PDF Puppeteer → impression ou téléchargement.
        </p>
      </Card>

      <Card className="p-6">
        <SectionHeader title="Périmètre" description="Établissement et classe cible." />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <Field label="Établissement">
            <Select
              value={schoolCode}
              onChange={(event) => setSchoolCode(event.target.value)}
              options={availableSchools.map(formatSchoolOption)}
            />
          </Field>
          <Field label="Classe">
            <Select
              value={className}
              onChange={(event) => setClassName(event.target.value)}
              options={classNames.map((name) => ({ value: name, label: name }))}
            />
          </Field>
        </div>
        {school ? (
          <p className="mt-3 text-sm font-semibold text-muted">
            {school.name} · {school.code}
            {school.city ? ` · ${school.city}` : ""}
          </p>
        ) : null}
      </Card>

      {draft ? (
        <Card className="p-6">
          <SectionHeader
            title="Éditeur visuel"
            description="Glissez les blocs « Données dynamiques » dans la mise en page. Les tokens seront remplacés à la génération."
          />
          <div className="mt-4">
            <BulletinGrapesEditor
              designKey={designKey}
              design={draft}
              onExport={handleEditorExport}
            />
          </div>
        </Card>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-6">
          <SectionHeader
            title="Matières incluses"
            description={`Notes calculées côté backend pour ${className || "—"}.`}
          />
          {!subjects.length ? (
            <p className="mt-4 text-sm font-semibold text-muted">
              Aucune matière trouvée. Configurez les matières dans Paramètres établissement.
            </p>
          ) : (
            <ul className="mt-4 space-y-2">
              {subjects.map((subject) => {
                const checked = draft?.enabledSubjects.includes(subject) ?? false;
                return (
                  <li key={subject}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-line px-3 py-2 hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleSubject(subject)}
                        className="h-4 w-4 accent-brand"
                      />
                      <span className="text-sm font-semibold text-ink">{subject}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-6">
          <SectionHeader title="Paramètres & génération" description="Options PDF et actions." />
          {draft ? (
            <div className="mt-4 space-y-4">
              <Field label="Titre du bulletin">
                <Input
                  value={draft.reportTitle}
                  onChange={(event) => setDraft({ ...draft, reportTitle: event.target.value })}
                />
              </Field>
              <Field label="Sous-titre">
                <Input
                  value={draft.reportSubtitle ?? ""}
                  onChange={(event) => setDraft({ ...draft, reportSubtitle: event.target.value })}
                />
              </Field>
              <Field label="Libellé de période par défaut">
                <Input
                  value={draft.periodLabel}
                  onChange={(event) => setDraft({ ...draft, periodLabel: event.target.value })}
                />
              </Field>
              <Field label="Note de pied de page">
                <Input
                  value={draft.footerNote}
                  onChange={(event) => setDraft({ ...draft, footerNote: event.target.value })}
                />
              </Field>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={draft.showRank}
                    onChange={(event) => setDraft({ ...draft, showRank: event.target.checked })}
                    className="h-4 w-4 accent-brand"
                  />
                  Afficher le rang
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={draft.showAppreciation}
                    onChange={(event) => setDraft({ ...draft, showAppreciation: event.target.checked })}
                    className="h-4 w-4 accent-brand"
                  />
                  Afficher l'appréciation
                </label>
                <label className="flex items-center gap-2 text-sm font-semibold text-ink">
                  <input
                    type="checkbox"
                    checked={draft.showQrCode}
                    onChange={(event) => setDraft({ ...draft, showQrCode: event.target.checked })}
                    className="h-4 w-4 accent-brand"
                  />
                  Afficher le QR code de vérification
                </label>
              </div>
              <div className="flex flex-wrap gap-3 pt-2">
                <Button disabled={saving || !subjects.length} onClick={() => void saveDesign()}>
                  {saving ? "Enregistrement…" : "Enregistrer le modèle"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={previewing || !subjects.length}
                  onClick={() => void previewDesign("html")}
                >
                  {previewing ? "Génération…" : "Visionner (HTML)"}
                </Button>
                <Button
                  variant="secondary"
                  disabled={downloadingPdf || !subjects.length}
                  onClick={() => void previewDesign("pdf")}
                >
                  {downloadingPdf ? "PDF…" : "Télécharger aperçu PDF"}
                </Button>
                <Button variant="secondary" onClick={resetDesign}>
                  Réinitialiser
                </Button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm font-semibold text-muted">Sélectionnez une classe.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
