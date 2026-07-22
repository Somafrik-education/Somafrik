/**
 * Overlays — D2.6.
 * Modal / ConfirmDialog — source de vérité DS.
 * PromptDialog reste legacy jusqu’à lot dédié.
 */

export { Modal, type ModalProps } from "./Modal";
export {
  ConfirmProvider,
  useConfirm,
  type ConfirmOptions,
  type ConfirmTone,
} from "./ConfirmDialog";
