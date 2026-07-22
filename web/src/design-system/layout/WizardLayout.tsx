import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * WizardLayout — assistant multi-étapes (P-008).
 * Zones D1.3 : Header → Stepper → Content → StickyActions.
 * Une seule étape visible à la fois (responsabilité du contenu métier).
 */
export interface WizardLayoutProps {
  header?: ReactNode;
  stepper?: ReactNode;
  content?: ReactNode;
  stickyActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("WizardLayout.Header");
const Stepper = createLayoutSlot("WizardLayout.Stepper");
const Content = createLayoutSlot("WizardLayout.Content");
const StickyActions = createLayoutSlot("WizardLayout.StickyActions");

const COMPOUND = [Header, Stepper, Content, StickyActions];

export function WizardLayout({
  header,
  stepper,
  content,
  stickyActions,
  className,
  children,
}: WizardLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotStepper = resolveSlot(stepper, children, Stepper);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotSticky = resolveSlot(stickyActions, children, StickyActions);

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl min-h-0 flex-1 flex-col gap-4",
        className,
      )}
    >
      {slotHeader ? <header className="shrink-0">{slotHeader}</header> : null}
      {slotStepper ? (
        <nav aria-label="Étapes du parcours" className="shrink-0">
          {slotStepper}
        </nav>
      ) : null}
      {slotContent ? (
        <section aria-label="Étape courante" className="min-h-0 flex-1">
          {slotContent}
        </section>
      ) : null}
      {slotSticky ? (
        <footer
          className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-white/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80"
          aria-label="Actions de l'assistant"
        >
          {slotSticky}
        </footer>
      ) : null}
    </div>
  );
}

WizardLayout.Header = Header;
WizardLayout.Stepper = Stepper;
WizardLayout.Content = Content;
WizardLayout.StickyActions = StickyActions;
