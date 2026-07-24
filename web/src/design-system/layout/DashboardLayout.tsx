import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * DashboardLayout — synthèse opérationnelle ou analytique (P-004 / P-005).
 */
export interface DashboardLayoutProps {
  header?: ReactNode;
  kpis?: ReactNode;
  alerts?: ReactNode;
  primaryActions?: ReactNode;
  content?: ReactNode;
  className?: string;
  children?: ReactNode;
}

const Header = createLayoutSlot("DashboardLayout.Header");
const Kpis = createLayoutSlot("DashboardLayout.Kpis");
const Alerts = createLayoutSlot("DashboardLayout.Alerts");
const PrimaryActions = createLayoutSlot("DashboardLayout.PrimaryActions");
const Content = createLayoutSlot("DashboardLayout.Content");

const COMPOUND = [Header, Kpis, Alerts, PrimaryActions, Content];

export function DashboardLayout({
  header,
  kpis,
  alerts,
  primaryActions,
  content,
  className,
  children,
}: DashboardLayoutProps) {
  const slotHeader = resolveSlot(header, children, Header);
  const slotKpis = resolveSlot(kpis, children, Kpis);
  const slotAlerts = resolveSlot(alerts, children, Alerts);
  const slotActions = resolveSlot(primaryActions, children, PrimaryActions);
  const slotContent =
    resolveSlot(content, children, Content) ?? getDefaultSlotChildren(children, COMPOUND);

  return (
    <div className={cn("space-y-6", className)}>
      {(slotHeader || slotActions) && (
        <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1">{slotHeader}</div>
          {slotActions ? (
            <div className="no-print flex shrink-0 flex-wrap items-center gap-2">{slotActions}</div>
          ) : null}
        </header>
      )}
      {slotAlerts ? <section aria-label="Alertes">{slotAlerts}</section> : null}
      {slotKpis ? <section aria-label="Indicateurs">{slotKpis}</section> : null}
      {slotContent ? <section aria-label="Contenu">{slotContent}</section> : null}
    </div>
  );
}

DashboardLayout.Header = Header;
DashboardLayout.Kpis = Kpis;
DashboardLayout.Alerts = Alerts;
DashboardLayout.PrimaryActions = PrimaryActions;
DashboardLayout.Content = Content;
