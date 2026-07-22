import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * ToolLayout — outil opérationnel (P-007) : présences, notes, planning…
 * Zones D1.3 : Header → Context → Content → StickyActions.
 * Densité élevée ; contenu métier hors layout.
 */
export interface ToolLayoutProps {
  header?: ReactNode;
  context?: ReactNode;
  content?: ReactNode;
  stickyActions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("ToolLayout.Header");
const Context = createLayoutSlot("ToolLayout.Context");
const Content = createLayoutSlot("ToolLayout.Content");
const StickyActions = createLayoutSlot("ToolLayout.StickyActions");

const COMPOUND = [Header, Context, Content, StickyActions];

export function ToolLayout({
  header,
  context,
  content,
  stickyActions,
  className,
  children,
}: ToolLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotContext = resolveSlot(context, children, Context);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotSticky = resolveSlot(stickyActions, children, StickyActions);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col gap-3", className)}>
      {slotHeader ? <header className="shrink-0">{slotHeader}</header> : null}
      {slotContext ? (
        <section
          aria-label="Contexte opérationnel"
          className="shrink-0 rounded-md border border-line bg-slate-50 px-3 py-2 text-sm"
        >
          {slotContext}
        </section>
      ) : null}
      {slotContent ? (
        <section aria-label="Zone de travail" className="min-h-0 flex-1 overflow-auto">
          {slotContent}
        </section>
      ) : null}
      {slotSticky ? (
        <footer
          className="sticky bottom-0 z-10 shrink-0 border-t border-line bg-white py-3"
          aria-label="Actions de l'outil"
        >
          {slotSticky}
        </footer>
      ) : null}
    </div>
  );
}

ToolLayout.Header = Header;
ToolLayout.Context = Context;
ToolLayout.Content = Content;
ToolLayout.StickyActions = StickyActions;
