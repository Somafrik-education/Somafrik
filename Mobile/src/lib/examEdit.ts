import { formatDateForDisplay, toApiDate } from "./dates";

export type ExamFormFields = {
  name: string;
  className: string;
  subject: string;
  date: string;
  period: string;
  examType: string;
};

export type ExamEditSource = {
  name?: string;
  className?: string;
  subject?: string;
  examType?: string;
  date?: string;
  period?: string;
};

export function examToForm(exam: ExamEditSource): ExamFormFields {
  return {
    name: String(exam.name ?? "").trim(),
    className: String(exam.className ?? "").trim(),
    subject: String(exam.subject ?? "").trim(),
    date: formatDateForDisplay(exam.date) || "",
    period: String(exam.period ?? "").trim(),
    examType: String(exam.examType ?? "").trim(),
  };
}

export function examFormToPatchPayload(form: ExamFormFields): Record<string, string> {
  const date = String(form.date ?? "").trim();
  return {
    name: String(form.name ?? "").trim(),
    className: String(form.className ?? "").trim(),
    subject: String(form.subject ?? "").trim(),
    date: toApiDate(date) || date,
    period: String(form.period ?? "").trim(),
    examType: String(form.examType ?? "").trim(),
  };
}

export function examPatchChanged(initial: ExamEditSource, form: ExamFormFields): boolean {
  return JSON.stringify(examFormToPatchPayload(form)) !== JSON.stringify(examFormToPatchPayload(examToForm(initial)));
}
