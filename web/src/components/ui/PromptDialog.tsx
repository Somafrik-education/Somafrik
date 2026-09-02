import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "./Button";
import { Field, Input } from "./Field";
import { Modal } from "./Modal";

export interface PromptOptions {
  title: string;
  description?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  inputType?: "text" | "password";
  required?: boolean;
  validate?: (value: string) => string | null;
}

interface PromptState extends PromptOptions {
  open: boolean;
  value: string;
  error: string;
}

interface PromptContextValue {
  prompt: (options: PromptOptions) => Promise<string | null>;
}

const PromptContext = createContext<PromptContextValue | null>(null);

const EMPTY_STATE: PromptState = {
  open: false,
  title: "",
  value: "",
  error: "",
};

export function PromptProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PromptState>(EMPTY_STATE);
  const resolveRef = useRef<((value: string | null) => void) | null>(null);
  const validateRef = useRef<PromptOptions["validate"]>(undefined);

  const close = useCallback((value: string | null) => {
    resolveRef.current?.(value);
    resolveRef.current = null;
    validateRef.current = undefined;
    setState(EMPTY_STATE);
  }, []);

  const prompt = useCallback((options: PromptOptions) => {
    return new Promise<string | null>((resolve) => {
      resolveRef.current = resolve;
      validateRef.current = options.validate;
      setState({
        open: true,
        title: options.title,
        description: options.description,
        defaultValue: options.defaultValue,
        placeholder: options.placeholder,
        confirmLabel: options.confirmLabel ?? "Valider",
        cancelLabel: options.cancelLabel ?? "Annuler",
        inputType: options.inputType ?? "text",
        required: options.required,
        value: options.defaultValue ?? "",
        error: "",
      });
    });
  }, []);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const value = state.value.trim();
    const validationError = validateRef.current?.(value) ?? null;
    if (validationError) {
      setState((prev) => ({ ...prev, error: validationError }));
      return;
    }
    close(value);
  }

  return (
    <PromptContext.Provider value={{ prompt }}>
      {children}
      <Modal
        open={state.open}
        title={state.title}
        description={state.description}
        onClose={() => close(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => close(null)}>
              {state.cancelLabel ?? "Annuler"}
            </Button>
            <Button type="submit" form="app-prompt-form">
              {state.confirmLabel ?? "Valider"}
            </Button>
          </>
        }
      >
        <form id="app-prompt-form" onSubmit={handleSubmit} className="space-y-3">
          <Field label={state.placeholder ?? "Saisie"} required={state.required}>
            <Input
              type={state.inputType ?? "text"}
              value={state.value}
              autoFocus
              required={state.required}
              onChange={(event) =>
                setState((prev) => ({ ...prev, value: event.target.value, error: "" }))
              }
            />
          </Field>
          {state.error ? <p className="text-sm text-danger">{state.error}</p> : null}
        </form>
      </Modal>
    </PromptContext.Provider>
  );
}

export function usePrompt(): PromptContextValue {
  const ctx = useContext(PromptContext);
  if (!ctx) throw new Error("usePrompt doit être utilisé dans <PromptProvider>");
  return ctx;
}
