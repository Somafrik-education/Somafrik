import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../BrandLogo";
import { marketingLogin, marketingNav } from "../../data/marketingContent";

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
      <div className="mx-auto flex min-w-0 max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link to="/" className="min-w-0 shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2">
          <BrandLogo size="md" imageClassName="h-10 w-10 object-contain" />
        </Link>

        <nav className="hidden items-center gap-1 md:flex" aria-label="Navigation vitrine">
          {marketingNav.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-brand-50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {link.label}
            </a>
          ))}
          <Link
            to={marketingLogin.href}
            className="ml-2 inline-flex min-h-11 items-center rounded-xl bg-brand-gradient px-4 py-2 text-sm font-bold text-white shadow-brand transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {marketingLogin.label}
          </Link>
        </nav>

        <div className="flex min-w-0 items-center gap-2 md:hidden">
          <button
            type="button"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-line px-3 text-sm font-bold text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            aria-expanded={open}
            aria-controls={menuId}
            onClick={() => setOpen((value) => !value)}
          >
            Menu
          </button>
          <Link
            to={marketingLogin.href}
            className="inline-flex min-h-11 items-center rounded-xl bg-brand-gradient px-3 py-2 text-sm font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
          >
            {marketingLogin.label}
          </Link>
        </div>
      </div>

      {open ? (
        <nav id={menuId} className="border-t border-line px-4 py-3 md:hidden" aria-label="Navigation vitrine mobile">
          <ul className="flex flex-col gap-1">
            {marketingNav.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="block rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  onClick={() => setOpen(false)}
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
