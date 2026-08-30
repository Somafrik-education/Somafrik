import { Link } from "react-router-dom";
import { BrandLogo } from "../BrandLogo";
import {
  marketingFooter,
  marketingLegalRoutes,
  marketingLogin,
  marketingNav,
} from "../../data/marketingContent";

export function MarketingFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="bg-[#0b1220] text-slate-300">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="min-w-0">
          <BrandLogo size="md" variant="onDark" imageClassName="h-12 w-12 object-contain" />
          <p className="mt-3 max-w-sm text-sm font-medium text-slate-400">{marketingFooter.tagline}</p>
          <small className="mt-3 block text-slate-500">
            © {year} {marketingFooter.copyrightName}. Tous droits réservés.
          </small>
        </div>
        <nav className="min-w-0" aria-label="Liens de la vitrine">
          <strong className="mb-3 block text-white">Somafrik</strong>
          {marketingNav.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="mb-2 block rounded-md text-sm text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {link.label}
            </a>
          ))}
        </nav>
        <nav className="min-w-0" aria-label="Accès à Somafrik">
          <strong className="mb-3 block text-white">Accès</strong>
          <Link
            to={marketingLogin.href}
            className="mb-2 block rounded-md text-sm text-slate-300 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            {marketingLogin.ctaLabel}
          </Link>
          {marketingLegalRoutes.length > 0
            ? marketingLegalRoutes.map((href) => (
                <a key={href} href={href} className="mb-2 block text-sm transition hover:text-white">
                  {href}
                </a>
              ))
            : null}
        </nav>
      </div>
    </footer>
  );
}
