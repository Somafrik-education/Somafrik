import { useEffect, useMemo, useState } from "react";
import { Card, SectionHeader } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Field, Select } from "../components/ui/Field";
import { requestBlob } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { useData } from "../context/DataContext";
import { parentLinkedStudents, parentStudentLabel } from "../lib/parentNotes";

function keys(student: Record<string, unknown> | null) {
  if (!student) return new Set<string>();
  return new Set(
    [student.id, student.studentId, student.studentUuid, student.publicId, student.matricule, student.studentCode]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean),
  );
}

export function ParentBulletinsPage() {
  const { session } = useAuth();
  const { state, ensureDomains } = useData();
  const user = session?.user ?? null;
  const schoolCode = String(user?.schoolCode ?? session?.school?.code ?? "").trim();
  const children = useMemo(() => parentLinkedStudents(user, state), [user, state]);
  const [selectedStudentId, setSelectedStudentId] = useState("");
  const [openingId, setOpeningId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void ensureDomains(["students", "bulletins"], schoolCode ? { schoolCode } : undefined).catch(() => undefined);
  }, [ensureDomains, schoolCode]);

  useEffect(() => {
    if (!children.length) {
      setSelectedStudentId("");
      return;
    }
    if (!children.some((child) => String(child.id ?? "") === selectedStudentId)) {
      setSelectedStudentId(String(children[0].id ?? ""));
    }
  }, [children, selectedStudentId]);

  const selectedChild =
    children.find((child) => String(child.id ?? "") === selectedStudentId) ?? children[0] ?? null;
  const allowed = useMemo(() => keys(selectedChild), [selectedChild]);
  const bulletins = (state.bulletins as Record<string, unknown>[]).filter((row) => {
    const status = String(row.status ?? "").trim().toLowerCase();
    const published = status === "published" || status === "publié" || status === "publie";
    return published && allowed.has(String(row.studentId ?? row.student_id ?? "").trim());
  });

  async function openPdf(row: Record<string, unknown>) {
    const studentId = String(row.studentId ?? row.student_id ?? selectedStudentId).trim();
    if (!studentId) return;
    setOpeningId(String(row.id ?? studentId));
    setError("");
    try {
      const period = String(row.period ?? "Trimestre 1").trim();
      const blob = await requestBlob(
        `/students/${encodeURIComponent(studentId)}/report.pdf?period=${encodeURIComponent(period)}`,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Impossible d'ouvrir le bulletin.");
    } finally {
      setOpeningId("");
    }
  }

  return (
    <div className="space-y-6" data-testid="parent-bulletins-page">
      <SectionHeader
        title="Bulletins"
        description="Bulletins publiés de vos enfants. Les brouillons et workflows internes ne sont jamais affichés."
      />

      {children.length > 1 ? (
        <Card className="p-4">
          <Field label="Enfant">
            <Select
              aria-label="Enfant"
              value={selectedStudentId}
              onChange={(event) => setSelectedStudentId(event.target.value)}
              options={children.map((child) => ({
                value: String(child.id ?? ""),
                label: parentStudentLabel(child),
              }))}
            />
          </Field>
        </Card>
      ) : null}

      {error ? (
        <Card className="border-red-200 bg-red-50 p-4">
          <p className="text-sm font-bold text-red-700">{error}</p>
        </Card>
      ) : null}

      {bulletins.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {bulletins.map((row, index) => {
            const id = String(row.id ?? index);
            return (
              <Card key={id} className="p-5">
                <p className="text-xs font-black uppercase tracking-wide text-brand">Bulletin publié</p>
                <h2 className="mt-1 font-black text-ink">{String(row.studentName ?? parentStudentLabel(selectedChild))}</h2>
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="font-bold text-muted">Période</p>
                    <p className="font-black text-ink">{String(row.period ?? "—")}</p>
                  </div>
                  <div>
                    <p className="font-bold text-muted">Moyenne</p>
                    <p className="font-black text-ink">
                      {row.average == null ? "—" : `${Number(row.average).toFixed(1)}/20`}
                    </p>
                  </div>
                </div>
                <Button
                  className="mt-4"
                  onClick={() => void openPdf(row)}
                  disabled={openingId === id}
                >
                  {openingId === id ? "Ouverture…" : "Voir le PDF"}
                </Button>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card className="p-6">
          <p className="text-sm font-semibold text-muted">Aucun bulletin publié pour cet enfant.</p>
        </Card>
      )}
    </div>
  );
}
