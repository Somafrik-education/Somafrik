import { useCallback, useReducer, useRef } from "react";
import type {
  EditableGuardianContact,
  EditableStudentAdministrativeDetails,
  EditableStudentIdentity,
  StudentCommandResult,
  StudentEditAuthorizationContext,
} from "../lib/studentEditing";
import {
  buildChangeSetForCommand,
  type StudentChangeSet,
} from "../lib/studentEditingChangeSet";
import type { StudentWorkspaceCommand } from "../lib/studentEditingCommands";
import {
  canSubmitEdit,
  createInitialEditControllerState,
  hasUnsavedChanges,
  reduceStudentEditController,
  type StudentEditControllerState,
} from "../lib/studentEditingController";
import type { StudentWorkspaceCommandRepository } from "../lib/studentEditingRepository";
import { executeStudentUpdateCommand } from "../lib/studentEditingService";
import {
  validateStudentWorkspaceCommand,
  type ValidateCommandOptions,
} from "../lib/studentEditingValidation";

export function useStudentEditController() {
  const [state, dispatch] = useReducer(
    reduceStudentEditController,
    undefined,
    createInitialEditControllerState,
  );
  const submittingLock = useRef(false);

  const startEdit = useCallback((draft: Record<string, unknown> = {}) => {
    submittingLock.current = false;
    dispatch({ type: "START_EDIT", draft });
  }, []);

  const updateDraft = useCallback((draft: Record<string, unknown>) => {
    dispatch({ type: "UPDATE_DRAFT", draft });
  }, []);

  const cancel = useCallback(() => {
    dispatch({ type: "CANCEL" });
  }, []);

  const reset = useCallback(() => {
    submittingLock.current = false;
    dispatch({ type: "RESET" });
  }, []);

  const setReason = useCallback((reason: string) => {
    dispatch({ type: "SET_REASON", reason });
  }, []);

  const continueToReview = useCallback(
    (
      command: StudentWorkspaceCommand,
      current:
        | EditableStudentIdentity
        | EditableGuardianContact
        | EditableStudentAdministrativeDetails,
      validationOptions: ValidateCommandOptions = {},
    ) => {
      const changeSet = buildChangeSetForCommand(command, current);
      const validation = validateStudentWorkspaceCommand(command, {
        ...validationOptions,
        changeSet,
        enforceReason: false,
        identity:
          command.type === "UPDATE_STUDENT_IDENTITY"
            ? (current as EditableStudentIdentity)
            : validationOptions.identity,
        guardian:
          command.type === "UPDATE_GUARDIAN_CONTACT"
            ? (current as EditableGuardianContact)
            : validationOptions.guardian,
        administrative:
          command.type === "UPDATE_STUDENT_ADMINISTRATIVE_DETAILS"
            ? (current as EditableStudentAdministrativeDetails)
            : validationOptions.administrative,
      });
      dispatch({
        type: "CONTINUE_TO_REVIEW",
        command,
        changeSet,
        errors: validation.valid ? [] : validation.errors,
      });
      return { changeSet, validation };
    },
    [],
  );

  const backToEdit = useCallback(() => {
    dispatch({ type: "BACK_TO_EDIT" });
  }, []);

  const confirmSubmit = useCallback(
    async (
      context: StudentEditAuthorizationContext,
      repository: StudentWorkspaceCommandRepository,
    ): Promise<StudentCommandResult | null> => {
      if (!canSubmitEdit(state) || !state.command) return null;
      if (submittingLock.current) return null;

      const commandWithReason: StudentWorkspaceCommand = {
        ...state.command,
        reason: state.reason.trim() || state.command.reason || null,
      };

      if (
        state.changeSet?.requiresReason &&
        !String(commandWithReason.reason ?? "").trim()
      ) {
        return {
          success: false,
          code: "VALIDATION_ERROR",
          errors: [
            {
              field: "reason",
              code: "REASON_REQUIRED",
              message:
                "Une raison est requise pour les changements sensibles.",
            },
          ],
        };
      }

      submittingLock.current = true;
      dispatch({ type: "SUBMIT_START" });

      try {
        const result = await executeStudentUpdateCommand(
          commandWithReason,
          context,
          repository,
        );
        if (result.success) {
          dispatch({ type: "SUBMIT_SUCCESS", result });
        } else {
          dispatch({ type: "SUBMIT_FAILURE", result });
        }
        return result;
      } finally {
        submittingLock.current = false;
      }
    },
    [state],
  );

  return {
    state,
    startEdit,
    updateDraft,
    cancel,
    reset,
    setReason,
    continueToReview,
    backToEdit,
    confirmSubmit,
    hasUnsavedChanges: hasUnsavedChanges(state),
    canSubmit: canSubmitEdit(state),
  };
}

export type { StudentEditControllerState, StudentChangeSet };
