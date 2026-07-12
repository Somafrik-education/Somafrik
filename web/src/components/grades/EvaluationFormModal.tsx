import { useMemo, useState, type FormEvent } from "react";
import type { Evaluation, EvaluationType, SessionUser } from "../../types";
import { Modal } from "../ui/Modal";
import { Field, Input, Select } from "../ui/Field";
import { Button } from "../ui/Button";
import {
  EVALUATION_TYPES,
  SCALE_OPTIONS,
  createEvaluation,
  getEvaluationTypes,
  resolveDefaultPeriod,
  subjectOptionsForClass,
} from "../../lib/evaluations";
import type { BackOfficeState } from "../../types";
import { inputToPeriodDate, periodDateToInput } from "../../lib/dates";
import { scopedTeachers } from "../../lib/establishment";
import { getTeacherDisplayName } from "../../lib/pedagogySync";

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
  const evaluationTypes = getEvaluationTypes(state, schoolCode);
  const teachers = scopedTeachers(user, state);
  const defaultPeriod = resolveDefaultPeriod(state, schoolCode);

  const [className, setClassName] = useState(initial?.className ?? classNames[0] ?? "");
  const [subject, setSubject] = useState(initial?.subject ?? "");
  const [teacherId, setTeacherId] = useState(initial?.teacherId ?? "");
  const [period, setPeriod] = useState(initial?.period ?? defaultPeriod);
  const [evaluationType, setEvaluationType] = useState<EvaluationType>(
    initial?.evaluationType ?? (evaluationTypes[0] as EvaluationType) ?? "Devoir",
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [date, setDate] = useState(periodDateToInput(initial?.date));
  const [scale, setScale] = useState(String(initial?.scale ?? 20));
  const [coefficient, setCoefficient] = useState(String(initial?.coefficient ?? 1));

  const subjects = useMemo(
    () => subjectOptionsForClass(state, schoolCode, className),
    [state, schoolCode, className],
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!className || !subject || !title.trim()) return;

    const teacher = teachers.find((row) => String(row.id) === teacherId);
    const payload = {
      schoolCode,
      className,
      subject,
      teacherId: teacherId || undefined,
      teacherName: teacher ? getTeacherDisplayName(teacher) : undefined,
      period,
      evaluationType,
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
          <Button form="evaluation-form" type="submit">
            Enregistrer
          </Button>
        </>
      }
    >
      <form id="evaluation-form" onSubmit={handleSubmit} className="grid gap-4">
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
        <Field label="Matière" htmlFor="eval-subject" required>
          <Select
            id="eval-subject"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            options={[
              { value: "", label: "Choisir…" },
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
        <Field label="Type" htmlFor="eval-type">
          <Select
            id="eval-type"
            value={evaluationType}
            onChange={(e) => setEvaluationType(e.target.value as EvaluationType)}
            options={(evaluationTypes.length ? evaluationTypes : EVALUATION_TYPES).map((type) => ({
              value: type,
              label: type,
            }))}
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
