import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * RecordLayout — fiche / workspace (P-003 + P-001).
 * Ordre D1.3 : Header → Summary → Alerts → Actions → Tabs → Content → Sidebar → History.
 */
export interface RecordLayoutProps {
  header?: ReactNode;
  summary?: ReactNode;
  alerts?: ReactNode;
  primaryActions?: ReactNode;
  secondaryActions?: ReactNode;
  tabs?: ReactNode;
  content?: ReactNode;
  sidebar?: ReactNode;
  history?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("RecordLayout.Header");
const Summary = createLayoutSlot("RecordLayout.Summary");
const Alerts = createLayoutSlot("RecordLayout.Alerts");
const PrimaryActions = createLayoutSlot("RecordLayout.PrimaryActions");
const SecondaryActions = createLayoutSlot("RecordLayout.SecondaryActions");
const Tabs = createLayoutSlot("RecordLayout.Tabs");
const Content = createLayoutSlot("RecordLayout.Content");
const Sidebar = createLayoutSlot("RecordLayout.Sidebar");
const History = createLayoutSlot("RecordLayout.History");

const COMPOUND = [
  Header,
  Summary,
  Alerts,
  PrimaryActions,
  SecondaryActions,
  Tabs,
  Content,
  Sidebar,
  History,
];

export function RecordLayout({
  header,
  summary,
  alerts,
  primaryActions,
  secondaryActions,
  tabs,
  content,
  sidebar,
  history,
  className,
  children,
}: RecordLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotSummary = resolveSlot(summary, children, Summary);
  const slotAlerts = resolveSlot(alerts, children, Alerts);
  const slotPrimary = resolveSlot(primaryActions, children, PrimaryActions);
  const slotSecondary = resolveSlot(secondaryActions, children, SecondaryActions);
  const slotTabs = resolveSlot(tabs, children, Tabs);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotSidebar = resolveSlot(sidebar, children, Sidebar);
  const slotHistory = resolveSlot(history, children, History);

  return (
    <div className={cn("space-y-6", className)}>
      {(slotHeader || slotPrimary || slotSecondary) && (
        <header className="space-y-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">{slotHeader}</div>
            {(slotPrimary || slotSecondary) && (
              <div className="no-print flex shrink-0 flex-wrap items-center gap-2">
                {slotSecondary}
                {slotPrimary}
              </div>
            )}
          </div>
        </header>
      )}

      {slotSummary ? (
        <section aria-label="Résumé métier">{slotSummary}</section>
      ) : null}

      {slotAlerts ? <section aria-label="Alertes">{slotAlerts}</section> : null}

      {slotTabs ? <nav aria-label="Sections de la fiche">{slotTabs}</nav> : null}

      <div
        className={cn(
          "grid gap-6",
          slotSidebar ? "lg:grid-cols-[minmax(0,1fr)_16rem]" : "grid-cols-1",
        )}
      >
        <div className="min-w-0 space-y-6">
          {slotContent ? <section aria-label="Contenu">{slotContent}</section> : null}
          {slotHistory ? <section aria-label="Historique">{slotHistory}</section> : null}
        </div>
        {slotSidebar ? (
          <aside className="min-w-0 space-y-4 lg:sticky lg:top-24 lg:self-start" aria-label="Panneau latéral">
            {slotSidebar}
          </aside>
        ) : null}
      </div>
    </div>
  );
}

RecordLayout.Header = Header;
RecordLayout.Summary = Summary;
RecordLayout.Alerts = Alerts;
RecordLayout.PrimaryActions = PrimaryActions;
RecordLayout.SecondaryActions = SecondaryActions;
RecordLayout.Tabs = Tabs;
RecordLayout.Content = Content;
RecordLayout.Sidebar = Sidebar;
RecordLayout.History = History;
