import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * ListLayout — collection filtrable (P-002).
 * Zones : Header, Description, Kpis, Filters, PrimaryActions, SecondaryActions, Content, Footer.
 */
export interface ListLayoutProps {
  header?: ReactNode;
  description?: ReactNode;
  kpis?: ReactNode;
  filters?: ReactNode;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  content?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("ListLayout.Header");
const Description = createLayoutSlot("ListLayout.Description");
const Kpis = createLayoutSlot("ListLayout.Kpis");
const Filters = createLayoutSlot("ListLayout.Filters");
const PrimaryActions = createLayoutSlot("ListLayout.PrimaryActions");
const SecondaryActions = createLayoutSlot("ListLayout.SecondaryActions");
const Content = createLayoutSlot("ListLayout.Content");
const Footer = createLayoutSlot("ListLayout.Footer");

const COMPOUND = [
  Header,
  Description,
  Kpis,
  Filters,
  PrimaryActions,
  SecondaryActions,
  Content,
  Footer,
];

export function ListLayout({
  header,
  description,
  kpis,
  filters,
  primaryActions,
  secondaryActions,
  content,
  footer,
  className,
  children,
}: ListLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotDescription = resolveSlot(description, children, Description);
  const slotKpis = resolveSlot(kpis, children, Kpis);
  const slotFilters = resolveSlot(filters, children, Filters);
  const slotPrimary = resolveSlot(primaryActions, children, PrimaryActions);
  const slotSecondary = resolveSlot(secondaryActions, children, SecondaryActions);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotFooter = resolveSlot(footer, children, Footer);

  return (
    <div className={cn("space-y-5", className)}>
      <header className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            {slotHeader}
            {slotDescription ? (
              <div className="text-sm text-muted">{slotDescription}</div>
            ) : null}
          </div>
          {(slotPrimary || slotSecondary) && (
            <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
              {slotSecondary}
              {slotPrimary}
            </div>
          )}
        </div>
        {slotKpis ? <section aria-label="Indicateurs">{slotKpis}</section> : null}
        {slotFilters ? (
          <section
            aria-label="Filtres et recherche"
            className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
          >
            {slotFilters}
          </section>
        ) : null}
      </header>
      {slotContent ? <section aria-label="Liste">{slotContent}</section> : null}
      {slotFooter ? <footer>{slotFooter}</footer> : null}
    </div>
  );
}

ListLayout.Header = Header;
ListLayout.Description = Description;
ListLayout.Kpis = Kpis;
ListLayout.Filters = Filters;
ListLayout.PrimaryActions = PrimaryActions;
ListLayout.SecondaryActions = SecondaryActions;
ListLayout.Content = Content;
ListLayout.Footer = Footer;
