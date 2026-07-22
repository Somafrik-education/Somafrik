import type { ReactNode } from "react";
import { cn } from "../utils/cn";
import {
  createLayoutSlot,
  getDefaultSlotChildren,
  resolveSlot,
} from "./slots";

/**
 * AppLayout (DS) — structure du shell applicatif.
 * Slots uniquement : aucune logique auth / routing / permissions.
 * Ne remplace pas `components/layout/AppLayout` en D2.2.
 */
export interface AppLayoutProps {
  /** Navigation latérale (desktop). */
  sidebar?: ReactNode;
  /** En-tête global (titre, recherche, profil…). */
  header?: ReactNode;
  /** Bannière transverse (abonnement, alerte système…). */
  banner?: ReactNode;
  /** Contenu principal. */
  main?: ReactNode;
  /** Drawer / nav mobile optionnel. */
  mobileNav?: ReactNode;
  className?: string;
  /** API composés : `<AppLayout.Sidebar />` etc. */
  children?: ReactNode;
}

const Sidebar = createLayoutSlot("AppLayout.Sidebar");
const Header = createLayoutSlot("AppLayout.Header");
const Banner = createLayoutSlot("AppLayout.Banner");
const Main = createLayoutSlot("AppLayout.Main");
const MobileNav = createLayoutSlot("AppLayout.MobileNav");

const COMPOUND = [Sidebar, Header, Banner, Main, MobileNav];

export function AppLayout({
  sidebar,
  header,
  banner,
  main,
  mobileNav,
  className,
  children,
}: AppLayoutProps) {
  const slotSidebar = resolveSlot(sidebar, children, Sidebar);
  const slotHeader = resolveSlot(header, children, Header);
  const slotBanner = resolveSlot(banner, children, Banner);
  const slotMain = resolveSlot(main, children, Main) ?? getDefaultSlotChildren(children, COMPOUND);
  const slotMobileNav = resolveSlot(mobileNav, children, MobileNav);

  return (
    <div className={cn("flex min-h-screen", className)}>
      {slotSidebar ? (
        <aside className="no-print hidden w-64 shrink-0 flex-col border-r border-line bg-white lg:flex">
          {slotSidebar}
        </aside>
      ) : null}
      {slotMobileNav}
      <div className="flex min-w-0 flex-1 flex-col">
        {slotHeader ? <header className="no-print sticky top-0 z-20">{slotHeader}</header> : null}
        <main className="flex-1 px-4 py-6 sm:px-6">
          <div className="mx-auto w-full max-w-6xl space-y-6">
            {slotBanner}
            {slotMain}
          </div>
        </main>
      </div>
    </div>
  );
}

AppLayout.Sidebar = Sidebar;
AppLayout.Header = Header;
AppLayout.Banner = Banner;
AppLayout.Main = Main;
AppLayout.MobileNav = MobileNav;
