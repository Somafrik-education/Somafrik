import { useEffect, useId, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogo } from "../BrandLogo";
import { marketingLogin, marketingNav } from "../../data/marketingContent";

export function MarketingHeader() {
  const [open, setOpen] = useState(false);
  const menuId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-white/95 shadow-[0_1px_0_rgba(15,23,42,0.04)] backdrop-blur">
      <div className="mx-auto flex min-w-0 max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link
          to="/"
          className="min-w-0 shrink rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
        >
          <BrandLogo
            showText
            subtitle=""
            size="md"
            imageClassName="h-9 w-9 object-contain sm:h-10 sm:w-10"
            className="min-w-0"
          />
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
            aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
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
        <nav id={menuId} className="border-t border-line bg-white px-4 py-3 md:hidden" aria-label="Navigation vitrine mobile">
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
