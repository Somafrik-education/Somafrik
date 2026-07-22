/**
 * Layouts officiels du Design System Somafrik (D2.2).
 *
 * Structure de page uniquement — aucune logique métier.
 * Slots explicites (compound components + props camelCase).
 *
 * @see docs/ux/design-system/LAYOUTS.md
 * @see docs/ux/architecture-pages-metier.md
 */

export { AppLayout, type AppLayoutProps } from "./AppLayout";
export { DashboardLayout, type DashboardLayoutProps } from "./DashboardLayout";
export { ListLayout, type ListLayoutProps } from "./ListLayout";
export { RecordLayout, type RecordLayoutProps } from "./RecordLayout";
export { FormLayout, type FormLayoutProps } from "./FormLayout";
export { WizardLayout, type WizardLayoutProps } from "./WizardLayout";
export { ToolLayout, type ToolLayoutProps } from "./ToolLayout";
export {
  createLayoutSlot,
  getDefaultSlotChildren,
  getSlotChildren,
  resolveSlot,
  SLOT_MARKER,
  type LayoutSlotComponent,
} from "./slots";
