import { useEffect, useMemo, useState } from "react";
import { Button, Modal } from "@/design-system";
import { Field, Input } from "../components/ui/Field";
import { ApiError } from "../api/client";
import { classesApi, type HeadTeacherCandidate, type SchoolClass } from "../lib/classesApi";
import { HEAD_TEACHER_COPY, classHasHeadTeacher } from "../lib/classHeadTeacher";
import { useConfirm } from "../components/ui/ConfirmDialog";

type Props = {
  open: boolean;
  schoolClass: SchoolClass | null;
  onClose: () => void;
  onAssigned: (updated: SchoolClass) => void;
  onRemoved: (updated: SchoolClass) => void;
  onError: (message: string) => void;
};

export function ClassHeadTeacherAssignModal({
  open,
  schoolClass,
  onClose,
  onAssigned,
  onRemoved,
  onError,
}: Props) {
  const { confirm } = useConfirm();
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<HeadTeacherCandidate[]>([]);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const assigned = schoolClass ? classHasHeadTeacher(schoolClass) : false;
  const currentCode = String(schoolClass?.headTeacherCode ?? schoolClass?.teacherId ?? "").trim();

  useEffect(() => {
    if (!open || !schoolClass) return;
    setQuery("");
    setSelected(currentCode);
    setLoadError(null);
    let cancelled = false;
    setLoading(true);
    void classesApi
      .listHeadTeacherCandidates(schoolClass.classCode)
      .then((rows) => {
        if (cancelled) return;
        setCandidates(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "Impossible de charger les enseignants.";
        setLoadError(message);
        setCandidates([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, schoolClass, currentCode]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((row) =>
      [row.displayName, row.firstName, row.lastName, row.teacherCode, row.alreadyHeadTeacherHint]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [candidates, query]);

  async function confirmAssign() {
    if (!schoolClass || saving || !selected) return;
    setSaving(true);
    try {
      const updated = await classesApi.assignHeadTeacher(schoolClass.classCode, selected);
      onAssigned(updated);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : HEAD_TEACHER_COPY.errorNetwork;
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  async function confirmRemove() {
    if (!schoolClass || saving) return;
    const ok = await confirm({
      title: HEAD_TEACHER_COPY.removeTitle,
      description: HEAD_TEACHER_COPY.removeDescription,
      confirmLabel: HEAD_TEACHER_COPY.remove,
      cancelLabel: HEAD_TEACHER_COPY.cancel,
      tone: "danger",
    });
    if (!ok) return;
    setSaving(true);
    try {
      const updated = await classesApi.removeHeadTeacher(schoolClass.classCode);
      onRemoved(updated);
      onClose();
    } catch (err) {
      const message =
        err instanceof ApiError ? err.message : HEAD_TEACHER_COPY.errorNetwork;
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={assigned ? HEAD_TEACHER_COPY.modalTitleModify : HEAD_TEACHER_COPY.modalTitleAssign}
    >
      <div className="space-y-3">
        <Field label={HEAD_TEACHER_COPY.search} htmlFor="head-teacher-search">
          <Input
            id="head-teacher-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={HEAD_TEACHER_COPY.search}
            autoComplete="off"
          />
        </Field>
        {loading ? (
          <p className="text-sm text-muted">Chargement des enseignants…</p>
        ) : loadError ? (
          <p className="text-sm text-red-700">{loadError}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">{HEAD_TEACHER_COPY.empty}</p>
        ) : (
          <ul className="max-h-64 space-y-1 overflow-y-auto" role="listbox" aria-label="Enseignants actifs">
            {filtered.map((row) => {
              const hint = row.alreadyHeadTeacherHint ||
                (row.otherClassNames?.length
                  ? HEAD_TEACHER_COPY.alreadyHint(row.otherClassNames.join(", "))
                  : "");
              return (
                <li key={row.teacherCode}>
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-border px-3 py-2">
                    <input
                      type="radio"
                      name="head-teacher"
                      value={row.teacherCode}
                      checked={selected === row.teacherCode}
                      onChange={() => setSelected(row.teacherCode)}
                    />
                    <span>
                      <span className="block text-sm font-semibold text-ink">
                        {row.displayName || `${row.firstName} ${String(row.lastName ?? "").toLocaleUpperCase("fr")}`.trim()}
                      </span>
                      {hint ? <span className="block text-xs text-amber-800">{hint}</span> : null}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap justify-end gap-2 pt-2">
          {assigned ? (
            <Button type="button" variant="secondary" disabled={saving} onClick={() => void confirmRemove()}>
              {HEAD_TEACHER_COPY.remove}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            {HEAD_TEACHER_COPY.cancel}
          </Button>
          <Button
            type="button"
            disabled={saving || !selected || selected === currentCode}
            onClick={() => void confirmAssign()}
          >
            {saving ? "Enregistrement…" : HEAD_TEACHER_COPY.confirm}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
