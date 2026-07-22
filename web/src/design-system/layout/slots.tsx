import {
  Children,
  isValidElement,
  type FC,
  type ReactElement,
  type ReactNode,
} from "react";

/** Marqueur interne pour les slots composés. */
export const SLOT_MARKER = "__somafrikLayoutSlot" as const;

export type LayoutSlotComponent = FC<{ children?: ReactNode }> & {
  [SLOT_MARKER]: string;
};

/** Crée un composant-slot nommé (compound API). */
export function createLayoutSlot(name: string): LayoutSlotComponent {
  const Slot: LayoutSlotComponent = ({ children }) => <>{children}</>;
  Slot.displayName = name;
  Slot[SLOT_MARKER] = name;
  return Slot;
}

function isSlotElement(
  child: ReactNode,
  slot: LayoutSlotComponent,
): child is ReactElement<{ children?: ReactNode }> {
  return (
    isValidElement(child) &&
    typeof child.type === "function" &&
    (child.type as LayoutSlotComponent)[SLOT_MARKER] === slot[SLOT_MARKER]
  );
}

/** Extrait le contenu d’un slot composé depuis `children`. */
export function getSlotChildren(
  children: ReactNode,
  slot: LayoutSlotComponent,
): ReactNode | undefined {
  const match = Children.toArray(children).find((child) => isSlotElement(child, slot));
  if (!match || !isValidElement<{ children?: ReactNode }>(match)) return undefined;
  return match.props.children;
}

/** Contenu restant (hors slots composés connus). */
export function getDefaultSlotChildren(
  children: ReactNode,
  slots: LayoutSlotComponent[],
): ReactNode {
  const markers = new Set(slots.map((s) => s[SLOT_MARKER]));
  const rest = Children.toArray(children).filter((child) => {
    if (!isValidElement(child) || typeof child.type !== "function") return true;
    const marker = (child.type as LayoutSlotComponent)[SLOT_MARKER];
    return !marker || !markers.has(marker);
  });
  return rest.length ? rest : undefined;
}

/** Résout prop nommée OU slot composé (prop prioritaire). */
export function resolveSlot(
  propValue: ReactNode | undefined,
  children: ReactNode | undefined,
  slot: LayoutSlotComponent,
): ReactNode | undefined {
  if (propValue !== undefined && propValue !== null) return propValue;
  if (children === undefined) return undefined;
  return getSlotChildren(children, slot);
}
