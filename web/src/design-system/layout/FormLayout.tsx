import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * FormLayout — page formulaire dédiée (création / édition).
 * Zones D1.3 : Header → Description → Alerts → Content → StickyActions.
 * Aucune logique métier ; les champs viennent des slots.
 */
export interface FormLayoutProps {
  header?: ReactNode;
  description?: ReactNode;
  alerts?: ReactNode;
  content?: ReactNode;
  stickyActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("FormLayout.Header");
const Description = createLayoutSlot("FormLayout.Description");
const Alerts = createLayoutSlot("FormLayout.Alerts");
const Content = createLayoutSlot("FormLayout.Content");
const StickyActions = createLayoutSlot("FormLayout.StickyActions");

const COMPOUND = [Header, Description, Alerts, Content, StickyActions];

export function FormLayout({
  header,
  description,
  alerts,
  content,
  stickyActions,
  className,
  children,
}: FormLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotDescription = resolveSlot(description, children, Description);
  const slotAlerts = resolveSlot(alerts, children, Alerts);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotSticky = resolveSlot(stickyActions, children, StickyActions);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-4", className)}>
      {(slotHeader || slotDescription) && (
        <header className="shrink-0 space-y-1">
          {slotHeader}
          {slotDescription ? (
            <div className="text-sm text-muted">{slotDescription}</div>
          ) : null}
        </header>
      )}
      {slotAlerts ? <section aria-label="Alertes">{slotAlerts}</section> : null}
      {slotContent ? (
        <section aria-label="Formulaire" className="min-h-0 flex-1">
          {slotContent}
        </section>
      ) : null}
      {slotSticky ? (
        <footer
          className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-white/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-white/80"
          aria-label="Actions du formulaire"
        >
          {slotSticky}
        </footer>
      ) : null}
    </div>
  );
}

FormLayout.Header = Header;
FormLayout.Description = Description;
FormLayout.Alerts = Alerts;
FormLayout.Content = Content;
FormLayout.StickyActions = StickyActions;
