/**
 * Feedback & états transverses — D2.4.
 *
 * Structure / présentation uniquement — aucune logique métier.
 * Coexistence avec `components/ui/Toast` et `PagePlaceholder`.
 *
 * @see docs/ux/design-system/FEEDBACK.md
 */

export { InlineAlert, type InlineAlertProps, type InlineAlertTone } from "./InlineAlert";
export { EmptyState, type EmptyStateProps } from "./EmptyState";
export { ComingSoonState, type ComingSoonStateProps } from "./ComingSoonState";
export { LoadingState, type LoadingStateProps } from "./LoadingState";
export { ErrorState, type ErrorStateProps } from "./ErrorState";
export { ForbiddenState, type ForbiddenStateProps } from "./ForbiddenState";
export {
  ToastProvider,
  useToast,
  type ToastContextValue,
  type ToastTone,
} from "./Toast";
