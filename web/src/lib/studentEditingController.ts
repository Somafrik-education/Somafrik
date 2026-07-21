import type {
  StudentCommandFailure,
  StudentCommandResult,
  StudentEditConflict,
  StudentEditMode,
  StudentEditValidationError,
} from "./studentEditing";
import type { StudentChangeSet } from "./studentEditingChangeSet";
import type { StudentWorkspaceCommand } from "./studentEditingCommands";

export interface StudentEditControllerState {
  mode: StudentEditMode;
  draft: Record<string, unknown>;
  command: StudentWorkspaceCommand | null;
  changeSet: StudentChangeSet | null;
  errors: StudentEditValidationError[];
  conflict: StudentEditConflict | null;
  submitting: boolean;
  lastResult: StudentCommandResult | null;
  reason: string;
}

export function createInitialEditControllerState(): StudentEditControllerState {
  return {
    mode: "READ",
    draft: {},
    command: null,
    changeSet: null,
    errors: [],
    conflict: null,
    submitting: false,
    lastResult: null,
    reason: "",
  };
}

export function hasUnsavedChanges(
  state: StudentEditControllerState,
): boolean {
  if (state.mode === "READ" || state.mode === "SUCCESS") return false;
  if (state.changeSet && !state.changeSet.isEmpty) return true;
  return Object.keys(state.draft).length > 0;
}

type EditControllerEvent =
  | { type: "START_EDIT"; draft?: Record<string, unknown> }
  | { type: "UPDATE_DRAFT"; draft: Record<string, unknown> }
  | {
      type: "CONTINUE_TO_REVIEW";
      command: StudentWorkspaceCommand;
      changeSet: StudentChangeSet;
      errors?: StudentEditValidationError[];
    }
  | { type: "BACK_TO_EDIT" }
  | { type: "CANCEL" }
  | { type: "SET_REASON"; reason: string }
  | { type: "SUBMIT_START" }
  | { type: "SUBMIT_SUCCESS"; result: StudentCommandResult }
  | {
      type: "SUBMIT_FAILURE";
      result: StudentCommandFailure;
    }
  | { type: "RESET" };

/**
 * Machine d'états d'édition — indépendante de React.
 *
 * READ → EDITING → REVIEWING → SUBMITTING → SUCCESS | CONFLICT | ERROR
 */
export function reduceStudentEditController(
  state: StudentEditControllerState,
  event: EditControllerEvent,
): StudentEditControllerState {
  switch (event.type) {
    case "START_EDIT":
      if (state.mode === "SUBMITTING") return state;
      return {
        ...createInitialEditControllerState(),
        mode: "EDITING",
        draft: event.draft ?? {},
      };

    case "UPDATE_DRAFT":
      if (state.mode !== "EDITING" && state.mode !== "ERROR") return state;
      return {
        ...state,
        mode: "EDITING",
        draft: event.draft,
        errors: [],
      };

    case "CONTINUE_TO_REVIEW": {
      if (state.mode !== "EDITING" && state.mode !== "ERROR") return state;
      if (event.errors && event.errors.length > 0) {
        return {
          ...state,
          mode: "ERROR",
          command: event.command,
          changeSet: event.changeSet,
          errors: event.errors,
        };
      }
      if (event.changeSet.isEmpty) {
        return {
          ...state,
          mode: "ERROR",
          command: event.command,
          changeSet: event.changeSet,
          errors: [
            {
              field: null,
              code: "NO_CHANGES",
              message: "Aucun changement réel à enregistrer.",
            },
          ],
        };
      }
      return {
        ...state,
        mode: "REVIEWING",
        command: event.command,
        changeSet: event.changeSet,
        errors: [],
        conflict: null,
      };
    }

    case "BACK_TO_EDIT":
      if (state.mode !== "REVIEWING" && state.mode !== "CONFLICT") return state;
      return {
        ...state,
        mode: "EDITING",
        conflict: null,
        errors: [],
      };

    case "CANCEL":
      if (state.mode === "SUBMITTING") return state;
      return createInitialEditControllerState();

    case "SET_REASON":
      return { ...state, reason: event.reason };

    case "SUBMIT_START":
      if (state.mode !== "REVIEWING") return state;
      if (state.submitting) return state;
      return {
        ...state,
        mode: "SUBMITTING",
        submitting: true,
        errors: [],
        conflict: null,
      };

    case "SUBMIT_SUCCESS":
      if (state.mode !== "SUBMITTING") return state;
      return {
        ...state,
        mode: "SUCCESS",
        submitting: false,
        lastResult: event.result,
        draft: {},
        command: null,
        changeSet: null,
      };

    case "SUBMIT_FAILURE": {
      if (state.mode !== "SUBMITTING") return state;
      if (event.result.code === "VERSION_CONFLICT" && event.result.conflict) {
        return {
          ...state,
          mode: "CONFLICT",
          submitting: false,
          lastResult: event.result,
          conflict: event.result.conflict,
          errors: event.result.errors,
        };
      }
      return {
        ...state,
        mode: "ERROR",
        submitting: false,
        lastResult: event.result,
        errors: event.result.errors,
      };
    }

    case "RESET":
      return createInitialEditControllerState();

    default:
      return state;
  }
}

/** Empêche le double envoi côté contrôleur. */
export function canSubmitEdit(state: StudentEditControllerState): boolean {
  return (
    state.mode === "REVIEWING" &&
    !state.submitting &&
    Boolean(state.command) &&
    Boolean(state.changeSet) &&
    !state.changeSet?.isEmpty
  );
}
