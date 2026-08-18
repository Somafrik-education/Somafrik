import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Evaluation, SessionUser } from "../../types";
import { Modal } from "../ui/Modal";
import { Field, Input, Select } from "../ui/Field";
import { Button } from "../ui/Button";
import { ApiError } from "../../api/client";
import { SCALE_OPTIONS, createEvaluation, resolveDefaultPeriod, subjectOptionsForClass } from "../../lib/evaluations";
import { evaluationTypesApi, type CanonicalEvaluationType } from "../../lib/evaluationTypesApi";
import type { BackOfficeState } from "../../types";
import { inputToPeriodDate, periodDateToInput } from "../../lib/dates";
import { scopedTeachers } from "../../lib/establishment";
import { getTeacherDisplayName } from "../../lib/pedagogySync";
import { isSuperAdminRole } from "../../lib/orgHierarchy";

interface EvaluationFormModalProps {
  open: boolean;
  onClose: () => void;
  onSave: (evaluation: Evaluation) => void;
  state: BackOfficeState;
  schoolCode: string;
  classNames: string[];
  user: SessionUser | null;
  initial?: Evaluation | null;
}

function formatTypeError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 400) return error.message || "Requête invalide.";
    if (error.status === 403) return "Accès refusé au catalogue des types d'évaluation.";
    if (error.status === 404) return "Type d'évaluation introuvable.";
    if (error.status === 409) return "Ce type d'évaluation n'est plus utilisable.";
    if (error.status >= 500) return "Erreur serveur lors du chargement des types.";
    return error.message;
  }
  return error instanceof Error ? error.message : "Impossible de charger les types d'évaluation.";
}

export function EvaluationFormModal({
  open,
  onClose,
  onSave,
  state,
  schoolCode,
  classNames,
  user,
  initial,
}: EvaluationFormModalProps) {
  const teachers = scopedTeachers(user, state);
  const defaultPeriod = resolveDefaultPeriod(state, schoolCode);
  const backoffice = isSuperAdminRole(user?.role);

  const [catalog, setCatalog] = useState<CanonicalEvaluationType[]>([]);
  const [catalogError, setCatalogError] = useState("");
  const [className, setClassName] = useState(initial?.className ?? classNames[0] ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? "");
  const [period, setPeriod] = useState(initial?.period ?? defaultPeriod);
  const [evaluationTypeId, setEvaluationTypeId] = useState(initial?.evaluationTypeId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(periodDateToInput(initial?.date));
  const [scale, setScale] = useState(String(initial?.scale ?? 20));
  const [coefficient, setCoefficient] = useState(String(initial?.coefficient ?? 1));

  useEffect(() => {
    if (!open || !schoolCode) return;
    let cancelled = false;
    void (async () => {
      try {
        const response = await evaluationTypesApi.list({
          schoolCode: backoffice ? schoolCode : undefined,
        });
        if (cancelled) return;
        const active = (response.types ?? []).filter((row) => row.status === "active");
        setCatalog(active);
        setCatalogError("");
        setEvaluationTypeId((current) => {
          if (current && active.some((row) => row.id === current)) return current;
          if (initial?.evaluationTypeId && active.some((row) => row.id === initial.evaluationTypeId)) {
            return initial.evaluationTypeId;
          }
          const byName = active.find((row) => row.name === initial?.evaluationType);
          return byName?.id ?? active[0]?.id ?? "";
        });
      } catch (error) {
        if (cancelled) return;
        setCatalog([]);
        setCatalogError(formatTypeError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, schoolCode, backoffice, initial?.evaluationTypeId, initial?.evaluationType]);

  const subjects = useMemo(
    () => subjectOptionsForClass(state, schoolCode, className),
    [state, schoolCode, className],
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!className || !subject || !title.trim()) return;
    if (!evaluationTypeId) {
      setCatalogError("Aucun type d'évaluation actif n'est disponible.");
      return;
    }
    const selectedType = catalog.find((row) => row.id === evaluationTypeId);
    if (!selectedType) {
      setCatalogError("Type d'évaluation introuvable ou archivé.");
      return;
    }

    const teacher = teachers.find((row) => String(row.id) === teacherId);
    const payload = {
      schoolCode,
      className,
      subject,
      teacherId: teacherId || undefined,
      teacherName: teacher ? getTeacherDisplayName(teacher) : undefined,
      period,
      evaluationType: selectedType.name,
      evaluationTypeId: selectedType.id,
      title: title.trim(),
      date: date ? inputToPeriodDate(date) : undefined,
      scale: Number(scale) || 20,
      coefficient: Number(coefficient) || 1,
    };

    if (initial) {
      onSave({ ...initial, ...payload });
    } else {
      onSave(createEvaluation(payload, user));
    }
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={initial ? "Modifier l'évaluation" : "Nouvelle évaluation"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button form="evaluation-form" type="submit" disabled={!catalog.length}>
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="evaluation-form" onSubmit={handleSubmit} className="grid gap-4">
        {catalogError ? <p className="text-sm text-danger">{catalogError}</p> : null}
        <Field label="Classe" htmlFor="eval-class" required>
          <Select
            id="eval-class"
            value={className}
            onChange={(e) => {
              setClassName(e.target.value);
              setSubject("");
            }}
            options={classNames.map((name) => ({ value: name, label: name }))}
          />
        </Field>
        <Field label="Cours" htmlFor="eval-subject" required>
          <Select
            id="eval-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            options={[
              { value: "", label: "Choisir un cours" },
              ...subjects.map((name) => ({ value: name, label: name })),
            ]}
          />
        </Field>
        <Field label="Enseignant" htmlFor="eval-teacher">
          <Select
            id="eval-teacher"
            value={teacherId}
            onChange={(e) => setTeacherId(e.target.value)}
            options={[
              { value: "", label: "Automatique" },
              ...teachers.map((teacher) => ({
                value: String(teacher.id ?? ""),
                label: getTeacherDisplayName(teacher),
              })),
            ]}
          />
        </Field>
        <Field label="Période" htmlFor="eval-period" required>
          <Input id="eval-period" value={period} onChange={(e) => setPeriod(e.target.value)} required />
        </Field>
        <Field label="Type" htmlFor="eval-type" required>
          <Select
            id="eval-type"
            value={evaluationTypeId}
            onChange={(e) => setEvaluationTypeId(e.target.value)}
            options={[
              { value: "", label: catalog.length ? "Choisir…" : "Aucun type actif" },
              ...catalog.map((type) => ({
                value: type.id,
                label: type.name,
              })),
            ]}
          />
        </Field>
        <Field label="Titre" htmlFor="eval-title" required>
          <Input
            id="eval-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Devoir n°1 — Mathématiques"
            required
          />
        </Field>
        <Field label="Date prévue" htmlFor="eval-date">
          <Input id="eval-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Barème" htmlFor="eval-scale">
            <Select
              id="eval-scale"
              value={scale}
              onChange={(e) => setScale(e.target.value)}
              options={[
                ...SCALE_OPTIONS.map((value) => ({ value: String(value), label: `/${value}` })),
                { value: scale, label: `/${scale}` },
              ]}
            />
          </Field>
          <Field label="Coefficient" htmlFor="eval-coef">
            <Input
              id="eval-coef"
              type="number"
              min={0.5}
              step={0.5}
              value={coefficient}
              onChange={(e) => setCoefficient(e.target.value)}
            />
          </Field>
        </div>
      </form>
    </Modal>
  );
}
