import { useMemo, useState } from "react";
import { Button, Modal } from "../../../design-system";
import { useStudentEditController } from "../../../hooks/useStudentEditController";
import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentEditAuthorizationContext,
} from "../../../lib/studentEditing";
import type { StudentWorkspaceCommandRepository } from "../../../lib/studentEditingRepository";
import { StudentEditButton } from "./StudentEditButton";
import { StudentIdentityEditForm } from "./StudentIdentityEditForm";
import { StudentGuardianContactEditForm } from "./StudentGuardianContactEditForm";
import { StudentAdministrativeEditForm } from "./StudentAdministrativeEditForm";
import { StudentEditReviewDialog } from "./StudentEditReviewDialog";
import { StudentEditConflictDialog } from "./StudentEditConflictDialog";
import { StudentEditSuccessBanner } from "./StudentEditSuccessBanner";
import { StudentUnsavedChangesDialog } from "./StudentUnsavedChangesDialog";

type EditTarget =
  | { kind: "identity"; current: EditableStudentIdentity }
  | {
      kind: "guardian";
      current: EditableGuardianContact;
      siblings: EditableGuardianContact[];
    }
  | { kind: "administrative"; current: EditableStudentAdministrativeDetails };

interface StudentEditingPanelProps {
  canUpdateIdentity: boolean;
  canUpdateGuardians: boolean;
  canUpdateAdministrative: boolean;
  identity: EditableStudentIdentity | null;
  guardians: EditableGuardianContact[];
  administrative: EditableStudentAdministrativeDetails | null;
  authContext: StudentEditAuthorizationContext;
  repository: StudentWorkspaceCommandRepository;
  onReload?: () => void;
  onSuccess?: () => void;
}

export function StudentEditingPanel({
  canUpdateIdentity,
  canUpdateGuardians,
  canUpdateAdministrative,
  identity,
  guardians,
  administrative,
  authContext,
  repository,
  onReload,
  onSuccess,
}: StudentEditingPanelProps) {
  const editor = useStudentEditController();
  const [target, setTarget] = useState<EditTarget | null>(null);
  const [unsavedOpen, setUnsavedOpen] = useState(false);
  const [successVersion, setSuccessVersion] = useState<number | null>(null);

  const isEditing =
    editor.state.mode === "EDITING" ||
    editor.state.mode === "ERROR" ||
    editor.state.mode === "REVIEWING" ||
    editor.state.mode === "SUBMITTING" ||
    editor.state.mode === "CONFLICT";

  const reasonError =
    editor.state.errors.find((item: { field: string | null }) => item.field === "reason")
      ?.message ?? null;

  const globalErrors = useMemo(
    () =>
      editor.state.errors.filter(
        (item: { field: string | null }) => item.field == null,
      ),
    [editor.state.errors],
  );

  const openIdentity = () => {
    if (!identity || !canUpdateIdentity) return;
    setTarget({ kind: "identity", current: identity });
    editor.startEdit({
      firstName: identity.firstName,
      lastName: identity.lastName,
      preferredName: identity.preferredName,
      gender: identity.gender,
      birthDate: identity.birthDate,
      birthPlace: identity.birthPlace,
      nationality: identity.nationality,
      address: identity.address,
      phone: identity.phone,
      email: identity.email,
    });
  };

  const openGuardian = (current: EditableGuardianContact) => {
    if (!canUpdateGuardians) return;
    setTarget({
      kind: "guardian",
      current,
      siblings: guardians,
    });
    editor.startEdit({
      phone: current.phone,
      email: current.email,
      address: current.address,
      isEmergencyContact: current.isEmergencyContact,
      pickupAuthorized: current.pickupAuthorized,
      priority: current.priority,
    });
  };

  const openAdministrative = () => {
    if (!administrative || !canUpdateAdministrative) return;
    setTarget({ kind: "administrative", current: administrative });
    editor.startEdit({
      administrativeNotes: administrative.administrativeNotes,
      preferredContactChannel: administrative.preferredContactChannel,
    });
  };

  const requestClose = () => {
    if (editor.state.mode === "SUBMITTING") return;
    if (editor.hasUnsavedChanges) {
      setUnsavedOpen(true);
      return;
    }
    editor.cancel();
    setTarget(null);
  };

  const continueReview = () => {
    if (!target) return;
    const draft = editor.state.draft;
    if (target.kind === "identity") {
      editor.continueToReview(
        {
          type: "UPDATE_STUDENT_IDENTITY",
          studentId: target.current.studentId,
          expectedVersion: target.current.version,
          changes: draft as unknown as EditableStudentIdentity,
          reason: editor.state.reason || null,
        },
        target.current,
      );
      return;
    }
    if (target.kind === "guardian") {
      editor.continueToReview(
        {
          type: "UPDATE_GUARDIAN_CONTACT",
          studentId: target.current.studentId,
          relationId: target.current.relationId,
          expectedVersion: target.current.version,
          changes: draft as unknown as EditableGuardianContact,
          reason: editor.state.reason || null,
        },
        target.current,
        { siblingGuardians: target.siblings },
      );
      return;
    }
    editor.continueToReview(
      {
        type: "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS",
        studentId: target.current.studentId,
        expectedVersion: target.current.version,
        changes: draft as unknown as EditableStudentAdministrativeDetails,
        reason: editor.state.reason || null,
      },
      target.current,
    );
  };

  const confirm = async () => {
    const result = await editor.confirmSubmit(authContext, repository);
    if (result?.success) {
      setSuccessVersion(result.newVersion);
      setTarget(null);
      onSuccess?.();
    }
  };

  return (
    <div className="space-y-4" data-testid="student-editing-panel">
      <StudentEditSuccessBanner
        visible={editor.state.mode === "SUCCESS" || successVersion != null}
        newVersion={
          editor.state.lastResult && editor.state.lastResult.success
            ? editor.state.lastResult.newVersion
            : successVersion
        }
        onDismiss={() => {
          setSuccessVersion(null);
          editor.reset();
        }}
      />

      <div className="flex flex-wrap gap-2">
        <StudentEditButton
          canUpdate={canUpdateIdentity && Boolean(identity)}
          onClick={openIdentity}
          label="Modifier l'identité"
        />
        <StudentEditButton
          canUpdate={canUpdateAdministrative && Boolean(administrative)}
          onClick={openAdministrative}
          label="Modifier les détails administratifs"
        />
      </div>

      {canUpdateGuardians && guardians.length > 0 ? (
        <div className="rounded-xl border border-line p-4">
          <p className="text-sm font-semibold text-ink">
            Coordonnées des responsables
          </p>
          <ul className="mt-3 space-y-2">
            {guardians.map((guardian) => (
              <li
                key={guardian.relationId}
                className="flex items-center justify-between gap-3"
              >
                <span className="text-sm text-ink">{guardian.displayName}</span>
                <StudentEditButton
                  canUpdate={canUpdateGuardians && guardian.isActive}
                  onClick={() => openGuardian(guardian)}
                  label="Modifier le contact"
                />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Modal
        open={isEditing && Boolean(target) && editor.state.mode !== "REVIEWING" && editor.state.mode !== "CONFLICT"}
        title={
          target?.kind === "identity"
            ? "Modifier l'identité"
            : target?.kind === "guardian"
              ? "Modifier le contact responsable"
              : "Modifier les détails administratifs"
        }
        description="Les modifications passent par une confirmation avant enregistrement."
        onClose={requestClose}
        size="lg"
        footer={
          <>
            <Button
              type="button"
              variant="secondary"
              onClick={requestClose}
              disabled={editor.state.mode === "SUBMITTING"}
            >
              Annuler
            </Button>
            <Button
              type="button"
              onClick={continueReview}
              disabled={editor.state.mode === "SUBMITTING"}
              data-testid="student-edit-continue"
            >
              Continuer
            </Button>
          </>
        }
      >
        {globalErrors.length > 0 ? (
          <div className="mb-4 rounded-lg border border-danger/30 bg-red-50 px-3 py-2" role="alert">
            {globalErrors.map((error) => (
              <p key={error.code} className="text-sm text-danger">
                {error.message}
              </p>
            ))}
          </div>
        ) : null}

        {target?.kind === "identity" ? (
          <StudentIdentityEditForm
            value={target.current}
            draft={editor.state.draft}
            errors={editor.state.errors}
            disabled={editor.state.mode === "SUBMITTING"}
            onChange={editor.updateDraft}
          />
        ) : null}
        {target?.kind === "guardian" ? (
          <StudentGuardianContactEditForm
            value={target.current}
            draft={editor.state.draft}
            errors={editor.state.errors}
            disabled={editor.state.mode === "SUBMITTING"}
            onChange={editor.updateDraft}
          />
        ) : null}
        {target?.kind === "administrative" ? (
          <StudentAdministrativeEditForm
            value={target.current}
            draft={editor.state.draft}
            errors={editor.state.errors}
            disabled={editor.state.mode === "SUBMITTING"}
            onChange={editor.updateDraft}
          />
        ) : null}
      </Modal>

      <StudentEditReviewDialog
        open={editor.state.mode === "REVIEWING" || editor.state.mode === "SUBMITTING"}
        changeSet={editor.state.changeSet}
        reason={editor.state.reason}
        requiresReason={Boolean(editor.state.changeSet?.requiresReason)}
        reasonError={reasonError}
        submitting={editor.state.mode === "SUBMITTING"}
        onReasonChange={editor.setReason}
        onBack={editor.backToEdit}
        onConfirm={() => {
          void confirm();
        }}
        onClose={requestClose}
      />

      <StudentEditConflictDialog
        open={editor.state.mode === "CONFLICT"}
        conflict={editor.state.conflict}
        onClose={() => {
          editor.cancel();
          setTarget(null);
        }}
        onReload={() => {
          editor.cancel();
          setTarget(null);
          onReload?.();
        }}
      />

      <StudentUnsavedChangesDialog
        open={unsavedOpen}
        onStay={() => setUnsavedOpen(false)}
        onDiscard={() => {
          setUnsavedOpen(false);
          editor.cancel();
          setTarget(null);
        }}
      />
    </div>
  );
}
