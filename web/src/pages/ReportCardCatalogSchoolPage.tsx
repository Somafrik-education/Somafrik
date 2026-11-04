/**
 * BULLETIN-CATALOG-01 — Pédagogie → Bulletins → Configurer un bulletin.
 *
 * L'établissement choisit un modèle AUTORISÉ dans son pays (déterminé par le
 * serveur), puis le configure avec un assistant : structure d'évaluation,
 * matières (et sous-matières si le modèle le permet), maxima, sources des
 * notes, aperçu, puis enregistrement et activation confirmée.
 *
 * Le serveur reste seul juge : droits, pays, validation des champs (erreurs
 * renvoyées par champ et affichées à côté du champ concerné).
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Card } from "../components/ui/Card";
import { Field, Input, Select } from "../components/ui/Field";
import { Button } from "../components/ui/Button";
import { Badge } from "../components/ui/Badge";
import { Modal } from "../components/ui/Modal";
import { ReportCardPresentationTable } from "../components/bulletin/ReportCardPresentationTable";
import { ReportCardModelThumbnail } from "../components/bulletin/ReportCardModelThumbnail";
import { reportCardManagementApi, type ManagedClass, type ReportCardPresentation } from "../lib/reportCardManagementApi";
import { useOptionalActiveSchool } from "../context/ActiveSchoolContext";
import { schoolLogoSrc } from "../lib/schoolLogo";
import {
  catalogErrorMessage,
  catalogUnavailability,
  fieldIssueMessage,
  fieldIssues,
  isAccessDenied,
  modelTypeLabel,
  reportCardCatalogApi,
  type ConfigurationContext,
  type ConfigurationInput,
  type FieldIssue,
  type HeaderElement,
  type HeaderInput,
  type HeaderLayout,
  type SchoolCatalog,
  type SchoolCatalogModel,
  type StructureId,
} from "../lib/reportCardCatalogApi";

const STEPS = [
  { id: "structure", label: "Classe et structure d'évaluation" },
  { id: "subjects", label: "Matières et maxima" },
  { id: "sources", label: "Calcul des notes" },
  { id: "header", label: "En-têtes et signatures" },
  { id: "preview", label: "Aperçu" },
  { id: "summary", label: "Récapitulatif et activation" },
] as const;

/** BULLETIN-CLASSE-01 / L4 — éléments d'en-tête proposés (liste fermée, ordre d'affichage). */
const HEADER_ELEMENTS: { id: HeaderElement; label: string }[] = [
  { id: "logo", label: "Logo de l'établissement" },
  { id: "establishment_name", label: "Nom de l'établissement" },
  { id: "establishment_address", label: "Adresse" },
  { id: "country", label: "Pays" },
  { id: "academic_year", label: "Année scolaire" },
  { id: "class", label: "Classe" },
  { id: "period", label: "Période" },
  { id: "student_name", label: "Nom de l'élève" },
  { id: "student_code", label: "Matricule" },
];
const HEADER_LAYOUTS: { id: HeaderLayout; label: string }[] = [
  { id: "logo_left", label: "Logo à gauche" },
  { id: "logo_center", label: "Logo centré" },
  { id: "no_logo", label: "Sans logo" },
];
const DEFAULT_HEADER: HeaderInput = {
  layout: "logo_left",
  show: ["logo", "establishment_name", "academic_year", "class", "period", "student_name", "student_code"],
  lines: [],
  title: "Bulletin scolaire",
};
type StepId = (typeof STEPS)[number]["id"];

const STRUCTURE_HELP: Record<StructureId, string> = {
  TJ_EX: "Deux colonnes par période : travail journalier (TJ) et examen (EX), chacune avec son maximum. Une matière peut n'avoir que le TJ.",
  SINGLE: "Une seule note par matière et par période, calculée à partir des évaluations choisies.",
};

const AGGREGATION_OPTIONS = [
  { value: "", label: "Choisir…" },
  { value: "sum", label: "Somme des évaluations" },
  { value: "weighted_average", label: "Moyenne pondérée des évaluations" },
];

const DEFAULT_MAX = 20;

function newCommandId() {
  const c = globalThis.crypto as Crypto | undefined;
  return c?.randomUUID ? c.randomUUID() : `cmd-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stepOfField(field: string): StepId {
  if (field.startsWith("structure")) return "structure";
  if (field.startsWith("subjects") || field === "profile") return "subjects";
  if (field.startsWith("factSources") || field.startsWith("periods")) return "sources";
  if (field.startsWith("signatures") || field.startsWith("header")) return "header";
  return "summary";
}

function componentsFor(ctx: ConfigurationContext, structure: StructureId) {
  return ctx.structures.find((entry) => entry.id === structure)?.components ?? [];
}

/** Configuration initiale : configuration existante, sinon structure suggérée et périodes pré-associées. */
function initialInput(ctx: ConfigurationContext): ConfigurationInput {
  if (ctx.current) {
    return {
      ...ctx.current,
      header: ctx.current.header ?? DEFAULT_HEADER,
      signatures: ctx.current.signatures ?? [],
      subjects: ctx.current.subjects.map((s) => ({ code: s.code, components: { ...s.components } })),
    };
  }
  const structure = ctx.suggestedStructure;
  const factSources: ConfigurationInput["factSources"] = {};
  for (const component of componentsFor(ctx, structure)) factSources[component.id] = { evaluationTypes: [], aggregation: "sum" };
  const periods: ConfigurationInput["periods"] = {};
  ctx.periods.forEach((period, index) => {
    const exact = ctx.terms.find((term) => term.trim().toLowerCase() === period.label.toLowerCase());
    const byOrder = ctx.terms[index];
    const pick = exact ?? byOrder;
    periods[period.id] = { termNames: pick ? [pick] : [] };
  });
  return { structure, subjects: [], factSources, periods, signatures: [], header: DEFAULT_HEADER };
}

function stateBadge(model: SchoolCatalogModel, forClass = false) {
  if (model.configuration === "ACTIVE") return <Badge tone="success">{forClass ? "Actif pour cette classe" : "Actif dans l'établissement"}</Badge>;
  if (!model.available) return <Badge tone="neutral">Non disponible</Badge>;
  if (model.configuration === "INHERITED") return <Badge tone="info">Hérité de l'établissement</Badge>;
  if (model.configuration === "SAVED") return <Badge tone="warning">Configuration enregistrée, non activée</Badge>;
  return <Badge tone="info">Disponible</Badge>;
}

function ErrorText({ issues }: { issues: FieldIssue[] }) {
  if (!issues.length) return null;
  return (
    <ul className="mt-1 space-y-0.5" role="alert">
      {issues.map((issue) => (
        <li key={`${issue.field}:${issue.code}`} className="text-xs font-semibold text-red-800">
          {fieldIssueMessage(issue.code)}
        </li>
      ))}
    </ul>
  );
}

function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6" data-testid="catalog-school">
      <nav aria-label="Fil d'Ariane" className="text-xs font-semibold text-muted">
        <span>Pédagogie</span> <span aria-hidden="true">›</span> <Link to="/bulletins" className="text-brand hover:underline">Bulletins</Link>{" "}
        <span aria-hidden="true">›</span> <span className="text-ink">Configurer un bulletin</span>
      </nav>
      {children}
    </div>
  );
}

export function ReportCardCatalogSchoolPage() {
  const [catalog, setCatalog] = useState<SchoolCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<SchoolCatalogModel | null>(null);
  const [notice, setNotice] = useState("");
  // BULLETIN-CLASSE-01 / L4 — état des modèles affiché pour une classe (vide : établissement).
  const [galleryClassId, setGalleryClassId] = useState("");
  const [galleryClasses, setGalleryClasses] = useState<ManagedClass[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setCatalog(await reportCardCatalogApi.schoolCatalog(galleryClassId || undefined));
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [galleryClassId]);

  useEffect(() => {
    let alive = true;
    reportCardManagementApi
      .listClasses()
      .then((rows) => alive && setGalleryClasses(rows))
      .catch(() => alive && setGalleryClasses([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (selected) {
    return (
      <PageShell>
        <ConfigurationWizard
          model={selected}
          initialClassId={galleryClassId}
          onExit={(message, classId) => {
            setSelected(null);
            if (message) setNotice(message);
            if (classId && classId !== galleryClassId) setGalleryClassId(classId);
            else void load();
          }}
        />
      </PageShell>
    );
  }

  const intro = (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold text-ink">Configurer un bulletin</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Choisissez un modèle autorisé pour votre pays, puis adaptez-le à vos matières, à vos maxima et à vos évaluations.
        </p>
      </div>
      <Link to="/bulletins" className="text-sm font-bold text-brand hover:underline">← Retour aux bulletins</Link>
    </div>
  );

  if (loading) {
    return (
      <PageShell>
        {intro}
        <Card className="p-6"><p role="status" className="text-sm text-muted" data-testid="catalog-school-loading">Chargement des modèles…</p></Card>
      </PageShell>
    );
  }
  if (error && catalogUnavailability(error)) {
    return (
      <PageShell>
        {intro}
        <Card className="p-6">
          <div data-testid="catalog-school-unavailable" role="status">
            <p className="text-sm font-bold text-ink">La configuration des bulletins par modèle n'est pas encore disponible.</p>
            <p className="mt-1 text-sm text-muted">
              Somafrik prépare l'ouverture du catalogue des modèles. Vos bulletins déjà publiés restent consultables et la gestion des bulletins n'est pas interrompue.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void load()}>Vérifier à nouveau</Button>
              <Link to="/bulletins" className="inline-flex items-center px-2 text-sm font-bold text-brand hover:underline">Retour aux bulletins</Link>
            </div>
          </div>
        </Card>
      </PageShell>
    );
  }
  if (error) {
    const denied = isAccessDenied(error);
    return (
      <PageShell>
        {intro}
        <Card className="p-6">
          <div data-testid={denied ? "catalog-school-denied" : "catalog-school-error"}>
            <p role="alert" className="text-sm font-bold text-red-800">
              {denied ? "Accès refusé : vos droits ne permettent pas de consulter la configuration des bulletins." : catalogErrorMessage(error)}
            </p>
            {!denied ? <Button className="mt-3" size="sm" variant="secondary" onClick={() => void load()}>Réessayer</Button> : null}
          </div>
        </Card>
      </PageShell>
    );
  }
  if (!catalog?.country) {
    return (
      <PageShell>
        {intro}
        <Card className="p-6">
          <div data-testid="catalog-school-no-country">
            <p className="text-sm font-bold text-ink">Le pays de votre établissement n'est pas reconnu.</p>
            <p className="mt-1 text-sm text-muted">Aucun modèle ne peut être proposé. Contactez le support Somafrik pour compléter la fiche de l'établissement.</p>
          </div>
        </Card>
      </PageShell>
    );
  }

  return (
    <PageShell>
      {intro}
      {notice ? <p role="status" className="rounded-xl bg-teal/10 px-4 py-3 text-sm font-semibold text-teal" data-testid="catalog-school-notice">{notice}</p> : null}
      {!catalog.canConfigure ? (
        <p className="rounded-xl bg-slate-100 px-4 py-3 text-sm text-slate-700" data-testid="catalog-school-readonly">
          Consultation seule : seule l'administration de l'établissement peut configurer un bulletin.
        </p>
      ) : null}
      {galleryClasses.length && catalog.models.length ? (
        <div className="max-w-sm" data-testid="catalog-school-class-filter">
          <Field label="Afficher l'état pour" htmlFor="catalog-gallery-class">
            <Select
              id="catalog-gallery-class"
              value={galleryClassId}
              onChange={(event) => setGalleryClassId(event.target.value)}
              options={[
                { value: "", label: "L'établissement (toutes classes)" },
                ...galleryClasses.map((item) => ({
                  value: item.id,
                  label: item.academicYearName ? `${item.name} — ${item.academicYearName}` : item.name,
                })),
              ]}
            />
          </Field>
        </div>
      ) : null}
      {catalog.models.length === 0 ? (
        <Card className="p-6">
          <div data-testid="catalog-school-empty">
            <p className="text-sm font-bold text-ink">Aucun modèle de bulletin n'est encore disponible pour {catalog.country.name}.</p>
            <p className="mt-1 text-sm text-muted">Les modèles sont ouverts pays par pays par Somafrik. Revenez plus tard ou contactez le support.</p>
          </div>
        </Card>
      ) : (
        <ul className="grid gap-5 lg:grid-cols-2" aria-label="Modèles disponibles">
          {catalog.models.map((model) => (
            <li key={model.model_id}>
              <Card className="flex h-full flex-col overflow-hidden">
                <article className="flex h-full flex-col" data-testid={`catalog-school-model-${model.model_id}`}>
                  <ReportCardModelThumbnail view={model.preview} label={`Aperçu du ${model.name}`} />
                  <div className="flex flex-1 flex-col gap-3 p-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h2 className="text-lg font-bold text-ink">{model.name}</h2>
                      {stateBadge(model, Boolean(galleryClassId))}
                    </div>
                    <div><Badge tone="info">{modelTypeLabel(model.presentation_style)}</Badge></div>
                    {model.description ? <p className="text-sm text-muted">{model.description}</p> : null}
                    {!model.available && model.configuration === "ACTIVE" ? (
                      <p className="text-xs text-muted">
                        Ce modèle n'est plus proposé dans votre pays : votre configuration active et vos bulletins publiés restent valides, mais elle ne peut plus être modifiée.
                      </p>
                    ) : null}
                    {catalog.canConfigure && model.available ? (
                      <div className="mt-auto pt-2">
                        <Button onClick={() => { setNotice(""); setSelected(model); }} data-testid={`catalog-school-choose-${model.model_id}`}>
                          {model.configuration === "NONE" ? "Choisir ce modèle" : "Modifier la configuration"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </article>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </PageShell>
  );
}

function ConfigurationWizard({
  model,
  initialClassId = "",
  onExit,
}: {
  model: SchoolCatalogModel;
  initialClassId?: string;
  onExit: (message?: string, classId?: string) => void;
}) {
  const [ctx, setCtx] = useState<ConfigurationContext | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [input, setInput] = useState<ConfigurationInput | null>(null);
  const [step, setStep] = useState<StepId>("structure");
  const [issues, setIssues] = useState<FieldIssue[]>([]);
  const [dirty, setDirty] = useState(false);
  const [savedState, setSavedState] = useState<"NONE" | "SAVED" | "ACTIVE">("NONE");
  const [preview, setPreview] = useState<ReportCardPresentation | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState<"" | "preview" | "save" | "activate">("");
  const [actionError, setActionError] = useState("");
  const [actionNotice, setActionNotice] = useState("");
  const [confirmActivate, setConfirmActivate] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // BULLETIN-CLASSE-01 / L4 — classe obligatoire avant toute configuration.
  const [classes, setClasses] = useState<ManagedClass[] | null>(null);
  const [classesError, setClassesError] = useState<unknown>(null);
  const [classId, setClassId] = useState(initialClassId);
  const [pendingClassId, setPendingClassId] = useState<string | null>(null);
  const activeSchool = useOptionalActiveSchool();
  const currentLogoSrc = activeSchool?.activeSchool ? schoolLogoSrc(activeSchool.activeSchool) : null;

  const loadClasses = useCallback(async () => {
    setClassesError(null);
    try {
      setClasses(await reportCardManagementApi.listClasses());
    } catch (err) {
      setClassesError(err);
    }
  }, []);

  useEffect(() => {
    void loadClasses();
  }, [loadClasses]);

  const load = useCallback(async () => {
    if (!classId) return;
    setLoadError(null);
    setCtx(null);
    setInput(null);
    try {
      const data = await reportCardCatalogApi.configurationContext(model.model_id, classId);
      setCtx(data);
      setInput(initialInput(data));
      setSavedState(data.pendingSaved ? "SAVED" : data.configuration === "INHERITED" ? "NONE" : data.configuration);
      setDirty(false);
      setPreview(null);
      setIssues([]);
    } catch (err) {
      setLoadError(err);
    }
  }, [model.model_id, classId]);

  useEffect(() => {
    void load();
  }, [load]);

  function chooseClass(next: string) {
    if (next === classId) return;
    if (dirty) {
      setPendingClassId(next);
      return;
    }
    setClassId(next);
  }

  const update = (next: (current: ConfigurationInput) => ConfigurationInput) => {
    setInput((current) => (current ? next(current) : current));
    setDirty(true);
    setPreview(null);
    setActionNotice("");
  };

  const issuesFor = (prefix: string, exact = false) =>
    issues.filter((issue) => (exact ? issue.field === prefix : issue.field === prefix || issue.field.startsWith(prefix + ".")));

  if (loadError) {
    return (
      <Card className="p-6">
        <div data-testid="catalog-wizard-error">
          <p role="alert" className="text-sm font-bold text-red-800">{catalogErrorMessage(loadError)}</p>
          <div className="mt-3 flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => void load()}>Réessayer</Button>
            <Button size="sm" variant="ghost" onClick={() => onExit()}>Retour aux modèles</Button>
          </div>
        </div>
      </Card>
    );
  }
  const classPicker = (
    <div className="space-y-2" data-testid="catalog-class-picker">
      <Field label="Classe à configurer" htmlFor="catalog-class" required>
        <Select
          id="catalog-class"
          value={classId}
          onChange={(event) => chooseClass(event.target.value)}
          options={[
            { value: "", label: classes === null ? "Chargement des classes…" : "Choisir une classe" },
            ...(classes ?? []).map((item) => ({
              value: item.id,
              label: item.academicYearName ? `${item.name} — ${item.academicYearName}` : item.name,
            })),
          ]}
        />
      </Field>
      {classesError ? (
        <p role="alert" className="text-sm font-semibold text-red-800">
          Impossible de charger les classes. <button type="button" className="underline" onClick={() => void loadClasses()}>Réessayer</button>
        </p>
      ) : null}
      {classes && classes.length === 0 ? <p className="text-sm text-muted" data-testid="catalog-no-class">Aucune classe dans l'établissement : créez d'abord les classes.</p> : null}
      <p className="text-xs text-muted">Chaque classe a sa propre configuration pour son année scolaire ; les autres classes ne sont jamais modifiées.</p>
    </div>
  );

  if (!classId || !ctx || !input) {
    return (
      <div className="space-y-5" data-testid="catalog-wizard">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-ink">{model.name}</h1>
            <p className="mt-1 text-sm text-muted">{modelTypeLabel(model.presentation_style)} · étape 1 : choisissez la classe</p>
          </div>
          <Button variant="ghost" onClick={() => onExit()}>← Retour aux modèles</Button>
        </div>
        <Card className="p-5 md:p-6">
          {classPicker}
          {classId && !ctx ? <p role="status" className="mt-4 text-sm text-muted">Chargement de la configuration de la classe…</p> : null}
        </Card>
      </div>
    );
  }
  const classLabel = ctx.class
    ? `${ctx.class.name ?? "Classe"} — ${ctx.class.academic_year_name ?? "année scolaire"}`
    : "";
  const header = input.header ?? DEFAULT_HEADER;

  const components = componentsFor(ctx, input.structure);
  const stepIndex = STEPS.findIndex((entry) => entry.id === step);
  const subjectName = (code: string) => ctx.subjects.find((s) => s.code === code)?.name ?? code;
  const parentCodes = new Set(ctx.subjects.map((s) => s.parent_code).filter(Boolean) as string[]);

  function goTo(next: StepId) {
    setStep(next);
    if (typeof window !== "undefined" && typeof window.scrollTo === "function") {
      try { window.scrollTo({ top: 0 }); } catch { /* jsdom */ }
    }
  }

  /** Contrôles immédiats (le serveur revalide tout). */
  function localIssues(target: StepId): FieldIssue[] {
    const out: FieldIssue[] = [];
    if (!input) return out;
    if (target === "subjects") {
      if (!input.subjects.length) out.push({ field: "subjects", code: "SUBJECTS_REQUIRED" });
      input.subjects.forEach((subject, index) => {
        const values = components.map((c) => subject.components[c.id]?.max).filter((v) => v !== undefined && v !== "");
        if (!values.length) out.push({ field: `subjects.${index}`, code: "SUBJECT_WITHOUT_COMPONENTS" });
        for (const c of components) {
          const raw = subject.components[c.id]?.max;
          if (raw === undefined || raw === "") continue;
          const n = Number(raw);
          if (!Number.isFinite(n) || n <= 0 || n > 1000) out.push({ field: `subjects.${index}.${c.id}`, code: "INVALID_MAX" });
        }
      });
    }
    if (target === "sources") {
      for (const c of components) {
        const source = input.factSources[c.id];
        if (!source?.evaluationTypes.length) out.push({ field: `factSources.${c.id}.evaluationTypes`, code: "EVALUATION_TYPES_REQUIRED" });
        if (!source?.aggregation) out.push({ field: `factSources.${c.id}.aggregation`, code: "AGGREGATION_REQUIRED" });
      }
      for (const period of ctx!.periods) {
        if (!input.periods[period.id]?.termNames.length) out.push({ field: `periods.${period.id}`, code: "TERM_REQUIRED" });
      }
    }
    return out;
  }

  function next() {
    const found = localIssues(step);
    if (found.length) {
      setIssues(found);
      return;
    }
    setIssues([]);
    const following = STEPS[stepIndex + 1];
    if (following) {
      goTo(following.id);
      if (following.id === "preview" && !preview) void runPreview();
    }
  }

  function serverInput(): ConfigurationInput {
    const current = input!;
    return {
      ...current,
      subjects: current.subjects.map((subject) => ({
        code: subject.code,
        components: Object.fromEntries(
          Object.entries(subject.components)
            .filter(([id, rule]) => components.some((c) => c.id === id) && rule.max !== "" && rule.max !== undefined)
            .map(([id, rule]) => [id, { max: Number(rule.max) }]),
        ),
      })),
      signatures: current.signatures.map((s) => s.trim()).filter(Boolean),
      header: {
        ...(current.header ?? DEFAULT_HEADER),
        lines: (current.header?.lines ?? []).map((line) => line.trim()).filter(Boolean),
        title: (current.header?.title ?? "").trim(),
      },
    };
  }

  function updateHeader(change: (current: HeaderInput) => HeaderInput) {
    update((current) => ({ ...current, header: change(current.header ?? DEFAULT_HEADER) }));
  }

  function handleServerError(err: unknown, setter: (message: string) => void) {
    const found = fieldIssues(err);
    if (found.length) {
      setIssues(found);
      goTo(stepOfField(found[0].field));
    }
    setter(catalogErrorMessage(err));
  }

  async function runPreview() {
    setBusy("preview");
    setPreviewError("");
    try {
      setPreview(await reportCardCatalogApi.preview(model.model_id, serverInput(), classId));
      setIssues([]);
    } catch (err) {
      handleServerError(err, setPreviewError);
    } finally {
      setBusy("");
    }
  }

  async function save() {
    setBusy("save");
    setActionError("");
    setActionNotice("");
    try {
      const result = await reportCardCatalogApi.save(model.model_id, serverInput(), classId);
      setPreview(result.preview ?? preview);
      setIssues([]);
      setDirty(false);
      setSavedState("SAVED");
      setActionNotice("Configuration enregistrée. Elle n'est pas encore utilisée : activez-la pour l'appliquer aux prochains bulletins.");
    } catch (err) {
      handleServerError(err, setActionError);
    } finally {
      setBusy("");
    }
  }

  async function activate() {
    setBusy("activate");
    setActionError("");
    try {
      await reportCardCatalogApi.activate(model.model_id, newCommandId(), classId);
      setConfirmActivate(false);
      onExit(`${model.name} est activé pour ${classLabel} : il sera utilisé pour les prochains aperçus et publications de cette classe. Les autres classes et les bulletins déjà publiés ne changent pas.`, classId);
    } catch (err) {
      setConfirmActivate(false);
      setActionError(`Activation refusée. ${catalogErrorMessage(err)}`);
    } finally {
      setBusy("");
    }
  }

  function toggleSubject(code: string, on: boolean) {
    update((current) => {
      if (!on) return { ...current, subjects: current.subjects.filter((s) => s.code !== code) };
      if (current.subjects.some((s) => s.code === code)) return current;
      const defaults = Object.fromEntries(components.map((c) => [c.id, { max: DEFAULT_MAX }]));
      return { ...current, subjects: [...current.subjects, { code, components: defaults }] };
    });
  }

  function changeStructure(structure: StructureId) {
    if (structure === input!.structure) return;
    const nextComponents = componentsFor(ctx!, structure);
    update((current) => ({
      ...current,
      structure,
      subjects: current.subjects.map((s) => ({ code: s.code, components: Object.fromEntries(nextComponents.map((c) => [c.id, { max: DEFAULT_MAX }])) })),
      factSources: Object.fromEntries(nextComponents.map((c) => [c.id, current.factSources[c.id] ?? { evaluationTypes: [], aggregation: "sum" }])),
    }));
  }

  const selectedCodes = new Set(input.subjects.map((s) => s.code));
  const groups: { title: string | null; items: { code: string; name: string }[] }[] = [];
  if (ctx.allowSubSubjects) {
    const simple = ctx.subjects.filter((s) => !s.parent_code && !parentCodes.has(s.code));
    if (simple.length) groups.push({ title: "Matières simples", items: simple });
    for (const parent of ctx.subjects.filter((s) => parentCodes.has(s.code))) {
      groups.push({ title: parent.name, items: ctx.subjects.filter((s) => s.parent_code === parent.code) });
    }
  } else {
    groups.push({ title: null, items: ctx.subjects.filter((s) => !s.parent_code && !parentCodes.has(s.code)) });
  }
  const hiddenCount = ctx.allowSubSubjects ? 0 : ctx.subjects.filter((s) => s.parent_code).length;

  const stepContent: Record<StepId, ReactNode> = {
    structure: (
      <div className="space-y-6">
      {classPicker}
      {ctx.configuration === "INHERITED" ? (
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-ink" data-testid="catalog-inherited-note">
          Cette classe utilise actuellement la configuration de l'établissement (lecture seule). Enregistrer et activer créeront sa configuration propre.
        </p>
      ) : null}
      <fieldset className="space-y-3" data-testid="catalog-step-structure">
        <legend className="text-base font-bold text-ink">Comment les notes sont-elles organisées ?</legend>
        <div className="grid gap-3 md:grid-cols-2">
          {ctx.structures.map((structure) => {
            const checked = input.structure === structure.id;
            return (
              <label
                key={structure.id}
                className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${checked ? "border-brand bg-brand-50" : "border-line bg-white hover:bg-slate-50"}`}
              >
                <input
                  type="radio"
                  name="catalog-structure"
                  className="mt-1"
                  value={structure.id}
                  checked={checked}
                  onChange={() => changeStructure(structure.id)}
                />
                <span>
                  <span className="block font-semibold text-ink">
                    {structure.label}
                    {structure.id === ctx.suggestedStructure ? <span className="ml-2 align-middle"><Badge tone="info">Suggéré pour ce modèle</Badge></span> : null}
                  </span>
                  <span className="mt-1 block text-sm text-muted">{STRUCTURE_HELP[structure.id]}</span>
                </span>
              </label>
            );
          })}
        </div>
        <ErrorText issues={issuesFor("structure")} />
        {input.subjects.length ? <p className="text-xs text-muted">Changer de structure réinitialise les maxima saisis.</p> : null}
      </fieldset>
      </div>
    ),
    subjects: (
      <div className="space-y-5" data-testid="catalog-step-subjects">
        <div>
          <h2 className="text-base font-bold text-ink">Matières affichées sur le bulletin</h2>
          <p className="mt-1 text-sm text-muted">
            {ctx.allowSubSubjects
              ? "Choisissez les matières simples et les sous-matières. Les matières principales affichent automatiquement le sous-total de leurs sous-matières."
              : "Ce modèle affiche des matières simples, sans sous-matières."}
          </p>
          {hiddenCount ? <p className="mt-1 text-xs text-muted">{hiddenCount} sous-matière(s) de l'établissement ne sont pas proposées par ce modèle.</p> : null}
        </div>
        {ctx.subjects.length === 0 ? (
          <p className="text-sm text-muted">Aucune matière active dans l'établissement. Créez d'abord les matières dans Pédagogie → Matières.</p>
        ) : (
          groups.map((group) => (
            <fieldset key={group.title ?? "all"} className="space-y-2">
              {group.title ? <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{group.title}</legend> : <legend className="sr-only">Matières</legend>}
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                {group.items.map((subject) => (
                  <label key={subject.code} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      checked={selectedCodes.has(subject.code)}
                      onChange={(event) => toggleSubject(subject.code, event.target.checked)}
                    />
                    <span>{subject.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          ))
        )}
        <ErrorText issues={issuesFor("subjects", true)} />
        {input.subjects.length ? (
          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-sm" data-testid="catalog-maxima">
              <caption className="px-4 pt-3 text-left text-sm font-bold text-ink">Maximum par période</caption>
              <thead className="text-xs uppercase text-muted">
                <tr>
                  <th className="px-4 py-2">Matière</th>
                  {components.map((c) => <th key={c.id} className="px-4 py-2">{c.label}</th>)}
                  <th className="px-4 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {input.subjects.map((subject, index) => {
                  const parent = ctx.subjects.find((s) => s.code === subject.code)?.parent_code;
                  return (
                    <tr key={subject.code} className="align-top">
                      <td className="px-4 py-2">
                        <span className="font-semibold text-ink">{subjectName(subject.code)}</span>
                        {parent ? <span className="block text-xs text-muted">{subjectName(parent)}</span> : null}
                        <ErrorText issues={issuesFor(`subjects.${index}`, true)} />
                      </td>
                      {components.map((c) => {
                        const id = `max-${subject.code}-${c.id}`;
                        return (
                          <td key={c.id} className="px-4 py-2">
                            <label htmlFor={id} className="sr-only">{`Maximum ${c.label} — ${subjectName(subject.code)}`}</label>
                            <Input
                              id={id}
                              inputMode="decimal"
                              className="w-24"
                              placeholder="—"
                              value={String(subject.components[c.id]?.max ?? "")}
                              aria-invalid={issuesFor(`subjects.${index}.${c.id}`, true).length ? true : undefined}
                              onChange={(event) => {
                                const value = event.target.value.replace(",", ".");
                                update((current) => ({
                                  ...current,
                                  subjects: current.subjects.map((s, i) =>
                                    i === index ? { ...s, components: { ...s.components, [c.id]: { max: value } } } : s,
                                  ),
                                }));
                              }}
                            />
                            <ErrorText issues={issuesFor(`subjects.${index}.${c.id}`, true)} />
                          </td>
                        );
                      })}
                      <td className="px-4 py-2 text-right">
                        <Button size="sm" variant="ghost" onClick={() => toggleSubject(subject.code, false)}>Retirer</Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {components.length > 1 ? <p className="px-4 pb-3 text-xs text-muted">Laissez une case vide si la composante ne s'applique pas à la matière.</p> : null}
          </div>
        ) : null}
      </div>
    ),
    sources: (
      <div className="space-y-6" data-testid="catalog-step-sources">
        <div>
          <h2 className="text-base font-bold text-ink">D'où viennent les notes ?</h2>
          <p className="mt-1 text-sm text-muted">Pour chaque colonne du bulletin, choisissez les types d'évaluation pris en compte et le mode de calcul.</p>
        </div>
        {components.map((c) => {
          const source = input.factSources[c.id] ?? { evaluationTypes: [], aggregation: "" as const };
          const aggId = `aggregation-${c.id}`;
          return (
            <fieldset key={c.id} className="space-y-3 rounded-xl border border-line p-4">
              <legend className="px-1 text-sm font-bold text-ink">{c.id === "NP" ? "Note de la période" : c.id === "TJ" ? "Travail journalier (TJ)" : c.id === "EX" ? "Examen (EX)" : c.label}</legend>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted">Types d'évaluation</p>
                {ctx.evaluationTypes.length === 0 ? (
                  <p className="mt-1 text-sm text-muted">Aucun type d'évaluation actif. Créez-les dans Pédagogie → Évaluations.</p>
                ) : (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {ctx.evaluationTypes.map((type) => (
                      <label key={type.code} className="flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={source.evaluationTypes.includes(type.code)}
                          onChange={(event) =>
                            update((current) => {
                              const prev = current.factSources[c.id] ?? { evaluationTypes: [], aggregation: "" as const };
                              const types = event.target.checked
                                ? [...prev.evaluationTypes, type.code]
                                : prev.evaluationTypes.filter((code) => code !== type.code);
                              return { ...current, factSources: { ...current.factSources, [c.id]: { ...prev, evaluationTypes: types } } };
                            })
                          }
                        />
                        {type.name}
                      </label>
                    ))}
                  </div>
                )}
                <ErrorText issues={issuesFor(`factSources.${c.id}.evaluationTypes`, true)} />
              </div>
              <div className="max-w-sm">
                <Field label="Mode de calcul" htmlFor={aggId}>
                  <Select
                    id={aggId}
                    value={source.aggregation}
                    options={AGGREGATION_OPTIONS}
                    onChange={(event) =>
                      update((current) => ({
                        ...current,
                        factSources: {
                          ...current.factSources,
                          [c.id]: { ...(current.factSources[c.id] ?? { evaluationTypes: [] }), aggregation: event.target.value as "sum" | "weighted_average" },
                        },
                      }))
                    }
                  />
                </Field>
                <ErrorText issues={issuesFor(`factSources.${c.id}.aggregation`, true)} />
              </div>
            </fieldset>
          );
        })}
        <fieldset className="space-y-3 rounded-xl border border-line p-4">
          <legend className="px-1 text-sm font-bold text-ink">Périodes du bulletin</legend>
          <p className="text-sm text-muted">Associez chaque période du bulletin à une ou plusieurs périodes de votre année scolaire.</p>
          {ctx.terms.length === 0 ? <p className="text-sm text-muted">Aucune période définie pour l'année scolaire en cours.</p> : null}
          <div className="grid gap-4 md:grid-cols-3">
            {ctx.periods.map((period) => (
              <div key={period.id}>
                <p className="text-sm font-semibold text-ink">{period.label}</p>
                <div className="mt-1 space-y-1">
                  {ctx.terms.map((term) => (
                    <label key={term} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={input.periods[period.id]?.termNames.includes(term) ?? false}
                        onChange={(event) =>
                          update((current) => {
                            const prev = current.periods[period.id]?.termNames ?? [];
                            const names = event.target.checked ? [...prev, term] : prev.filter((n) => n !== term);
                            return { ...current, periods: { ...current.periods, [period.id]: { termNames: names } } };
                          })
                        }
                      />
                      {term}
                    </label>
                  ))}
                </div>
                <ErrorText issues={issuesFor(`periods.${period.id}`, true)} />
              </div>
            ))}
          </div>
        </fieldset>
      </div>
    ),
    header: (
      <div className="space-y-6" data-testid="catalog-step-header">
        <fieldset className="space-y-2">
          <legend className="text-base font-bold text-ink">Disposition de l'en-tête</legend>
          <div className="flex flex-wrap gap-2">
            {HEADER_LAYOUTS.map((layout) => (
              <label key={layout.id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${header.layout === layout.id ? "border-brand bg-brand-50" : "border-line bg-white"}`}>
                <input
                  type="radio"
                  name="catalog-header-layout"
                  checked={header.layout === layout.id}
                  onChange={() =>
                    updateHeader((current) => ({
                      ...current,
                      layout: layout.id,
                      show: layout.id === "no_logo" ? current.show.filter((id) => id !== "logo") : current.show,
                    }))
                  }
                />
                {layout.label}
              </label>
            ))}
          </div>
          <ErrorText issues={issuesFor("header.layout", true)} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-base font-bold text-ink">Informations affichées</legend>
          <p className="text-sm text-muted">Brouillon : informations actuelles de l'établissement. Bulletin publié : informations figées au moment de la publication.</p>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {HEADER_ELEMENTS.map((element) => {
              const disabled = element.id === "logo" && header.layout === "no_logo";
              return (
                <label key={element.id} className={`flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm ${disabled ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    disabled={disabled}
                    checked={header.show.includes(element.id)}
                    onChange={(event) =>
                      updateHeader((current) => ({
                        ...current,
                        show: event.target.checked
                          ? HEADER_ELEMENTS.map((e) => e.id).filter((id) => id === element.id || current.show.includes(id))
                          : current.show.filter((id) => id !== element.id),
                      }))
                    }
                  />
                  {element.label}
                </label>
              );
            })}
          </div>
          <ErrorText issues={issuesFor("header.show", true)} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-base font-bold text-ink">Texte de l'en-tête</legend>
          <div className="max-w-md">
            <Field label="Titre du document" htmlFor="catalog-header-title" hint="60 caractères au maximum.">
              <Input
                id="catalog-header-title"
                maxLength={60}
                value={header.title}
                onChange={(event) => updateHeader((current) => ({ ...current, title: event.target.value }))}
              />
            </Field>
            <ErrorText issues={issuesFor("header.title", true)} />
          </div>
          <p className="text-sm text-muted">Jusqu'à quatre lignes officielles (exemple : République, ministère, province).</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Input
                key={i}
                aria-label={`Ligne d'en-tête ${i + 1}`}
                maxLength={80}
                placeholder={`Ligne ${i + 1}`}
                value={header.lines[i] ?? ""}
                onChange={(event) =>
                  updateHeader((current) => {
                    const lines = [...current.lines];
                    while (lines.length <= i) lines.push("");
                    lines[i] = event.target.value;
                    return { ...current, lines };
                  })
                }
              />
            ))}
          </div>
          <ErrorText issues={issuesFor("header.lines", true)} />
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-base font-bold text-ink">Signatures en bas du bulletin</legend>
          <p className="text-sm text-muted">Jusqu'à quatre intitulés (exemple : Le titulaire, Le chef d'établissement, Le parent).</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Input
                key={i}
                aria-label={`Signature ${i + 1}`}
                maxLength={60}
                placeholder={`Signature ${i + 1}`}
                value={input.signatures[i] ?? ""}
                onChange={(event) =>
                  update((current) => {
                    const list = [...current.signatures];
                    while (list.length <= i) list.push("");
                    list[i] = event.target.value;
                    return { ...current, signatures: list };
                  })
                }
              />
            ))}
          </div>
          <ErrorText issues={issuesFor("signatures", true)} />
        </fieldset>
      </div>
    ),
    preview: (
      <div className="space-y-5" data-testid="catalog-step-preview">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" onClick={() => void runPreview()} disabled={busy === "preview"} data-testid="catalog-preview-refresh">
            {busy === "preview" ? "Calcul de l'aperçu…" : preview ? "Actualiser l'aperçu" : "Afficher l'aperçu"}
          </Button>
          <p className="text-xs text-muted">Bulletin d'exemple calculé avec des notes fictives, selon vos réglages. Les notes inférieures à la moitié du maximum apparaissent en rouge et soulignées.</p>
        </div>
        {previewError ? <p role="alert" className="text-sm font-bold text-red-800">{previewError}</p> : null}
        {preview ? (
          <div className="overflow-x-auto rounded-xl border border-line bg-white p-3" data-testid="catalog-preview">
            <ReportCardPresentationTable view={preview} currentLogoSrc={currentLogoSrc} />
          </div>
        ) : null}
      </div>
    ),
    summary: (
      <div className="space-y-5" data-testid="catalog-step-summary">
        <h2 className="text-base font-bold text-ink">Récapitulatif</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          <dt className="text-muted">Classe</dt>
          <dd className="font-semibold text-ink" data-testid="catalog-summary-class">{classLabel}</dd>
          <dt className="text-muted">Modèle</dt>
          <dd className="font-semibold text-ink">{model.name}</dd>
          <dt className="text-muted">Structure</dt>
          <dd className="font-semibold text-ink">{ctx.structures.find((s) => s.id === input.structure)?.label}</dd>
          <dt className="text-muted">Matières</dt>
          <dd className="text-ink">
            <ul className="space-y-0.5">
              {input.subjects.map((s) => (
                <li key={s.code}>
                  <span className="font-semibold">{subjectName(s.code)}</span>{" "}
                  <span className="text-muted">
                    {components
                      .filter((c) => s.components[c.id]?.max !== undefined && s.components[c.id]?.max !== "")
                      .map((c) => `${c.label} /${s.components[c.id]?.max}`)
                      .join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          </dd>
          <dt className="text-muted">Périodes</dt>
          <dd className="text-ink">
            {ctx.periods.map((p) => `${p.label} : ${(input.periods[p.id]?.termNames ?? []).join(", ") || "—"}`).join(" · ")}
          </dd>
          <dt className="text-muted">En-tête</dt>
          <dd className="text-ink" data-testid="catalog-summary-header">
            {[header.title, ...header.lines].filter((v) => v && v.trim()).join(" · ") || "Sans texte"}
            {" — "}
            {HEADER_ELEMENTS.filter((e) => header.show.includes(e.id)).map((e) => e.label).join(", ") || "aucun élément"}
          </dd>
          <dt className="text-muted">Signatures</dt>
          <dd className="text-ink">{input.signatures.filter((s) => s.trim()).join(" · ") || "Aucune"}</dd>
          <dt className="text-muted">État</dt>
          <dd className="text-ink" data-testid="catalog-summary-state">
            {dirty
              ? "Modifications non enregistrées"
              : savedState === "ACTIVE"
                ? "Configuration active"
                : savedState === "SAVED"
                  ? "Enregistrée, non activée"
                  : "Non enregistrée"}
          </dd>
        </dl>
        {issues.length ? (
          <p role="alert" className="text-sm font-bold text-red-800">Des champs sont à corriger : utilisez les étapes signalées ci-dessus.</p>
        ) : null}
        {actionNotice ? <p role="status" className="rounded-lg bg-teal/10 px-3 py-2 text-sm font-semibold text-teal" data-testid="catalog-saved">{actionNotice}</p> : null}
        {actionError ? <p role="alert" className="text-sm font-bold text-red-800" data-testid="catalog-action-error">{actionError}</p> : null}
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => void save()} disabled={busy !== ""} data-testid="catalog-save">
            {busy === "save" ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button
            onClick={() => { setActionError(""); setConfirmActivate(true); }}
            disabled={busy !== "" || dirty || savedState !== "SAVED"}
            data-testid="catalog-activate"
          >
            Activer ce bulletin
          </Button>
        </div>
        <p className="text-xs text-muted">
          « Enregistrer » conserve la configuration sans l'utiliser. « Activer » l'applique aux prochains aperçus et publications ; les bulletins déjà publiés ne changent jamais.
          {dirty || savedState === "NONE" ? " Enregistrez d'abord vos modifications pour pouvoir activer." : savedState === "ACTIVE" ? " Cette configuration est déjà active." : ""}
        </p>
      </div>
    ),
  };

  const stepsWithIssues = new Set(issues.map((issue) => stepOfField(issue.field)));

  return (
    <div className="space-y-5" data-testid="catalog-wizard">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-ink">{model.name}</h1>
          <p className="mt-1 text-sm text-muted">{modelTypeLabel(model.presentation_style)} · configuration de la classe</p>
          <p className="mt-1"><Badge tone="info">{classLabel}</Badge></p>
        </div>
        <Button variant="ghost" onClick={() => (dirty ? setConfirmLeave(true) : onExit())}>← Retour aux modèles</Button>
      </div>

      <nav aria-label="Étapes de configuration">
        <ol className="flex flex-wrap gap-2">
          {STEPS.map((entry, index) => {
            const current = entry.id === step;
            const flagged = stepsWithIssues.has(entry.id);
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  aria-current={current ? "step" : undefined}
                  onClick={() => { goTo(entry.id); if (entry.id === "preview" && !preview) void runPreview(); }}
                  className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                    current ? "border-brand bg-brand text-white" : flagged ? "border-red-300 bg-red-50 text-red-800" : "border-line bg-white text-ink hover:bg-slate-50"
                  }`}
                >
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${current ? "bg-white/20" : "bg-slate-100"}`}>{index + 1}</span>
                  {entry.label}
                  {flagged ? <span className="sr-only"> (à corriger)</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <Card className="p-5 md:p-6">{stepContent[step]}</Card>

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="secondary" disabled={stepIndex === 0} onClick={() => { setIssues([]); goTo(STEPS[Math.max(0, stepIndex - 1)].id); }}>
          Précédent
        </Button>
        {stepIndex < STEPS.length - 1 ? <Button onClick={next} data-testid="catalog-next">Suivant</Button> : null}
      </div>

      <Modal
        open={confirmActivate}
        title="Activer ce bulletin ?"
        description="Vérifiez le récapitulatif avant de confirmer."
        onClose={() => (busy ? undefined : setConfirmActivate(false))}
        footer={
          <>
            <Button variant="secondary" disabled={busy !== ""} onClick={() => setConfirmActivate(false)}>Annuler</Button>
            <Button disabled={busy !== ""} onClick={() => void activate()} data-testid="catalog-activate-confirm">
              {busy === "activate" ? "Activation…" : "Confirmer l'activation"}
            </Button>
          </>
        }
      >
        <div className="space-y-2 text-sm" data-testid="catalog-activate-summary">
          <p><span className="text-muted">Classe :</span> <span className="font-semibold">{classLabel}</span></p>
          <p><span className="text-muted">Modèle :</span> <span className="font-semibold">{model.name}</span></p>
          <p><span className="text-muted">Matières :</span> <span className="font-semibold">{input.subjects.length}</span></p>
          <p><span className="text-muted">Structure :</span> <span className="font-semibold">{ctx.structures.find((s) => s.id === input.structure)?.label}</span></p>
          <p className="text-muted">Les prochains aperçus et publications utiliseront cette configuration. Les bulletins déjà publiés et leurs QR codes restent inchangés.</p>
        </div>
      </Modal>

      <Modal
        open={confirmLeave}
        title="Quitter sans enregistrer ?"
        description="Vos modifications non enregistrées seront perdues."
        onClose={() => setConfirmLeave(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmLeave(false)}>Continuer la configuration</Button>
            <Button variant="danger" onClick={() => onExit()}>Quitter sans enregistrer</Button>
          </>
        }
      >
        <p className="text-sm text-muted">Vous pouvez aussi revenir au récapitulatif et cliquer sur « Enregistrer ».</p>
      </Modal>

      <Modal
        open={pendingClassId !== null}
        title="Changer de classe ?"
        description="Les modifications non enregistrées pour la classe actuelle seront perdues."
        onClose={() => setPendingClassId(null)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingClassId(null)}>Rester sur cette classe</Button>
            <Button variant="danger" onClick={() => { const next = pendingClassId ?? ""; setPendingClassId(null); setDirty(false); setStep("structure"); setClassId(next); }}>
              Changer de classe
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">La configuration des autres classes n'est jamais modifiée.</p>
      </Modal>
    </div>
  );
}

export default ReportCardCatalogSchoolPage;
