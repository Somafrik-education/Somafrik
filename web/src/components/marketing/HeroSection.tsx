import { Link } from "react-router-dom";
import { Button } from "../ui/shadcn/button";
import { marketingHero } from "../../data/marketingContent";
import { ProductVisual } from "./ProductVisual";

export function HeroSection() {
  return (
    <section className="border-b border-line bg-gradient-to-b from-white to-brand-50" aria-labelledby="vitrine-titre">
      <div className="mx-auto grid max-w-6xl items-center gap-8 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-2 lg:gap-12 lg:py-20">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingHero.eyebrow}</p>
          <h1 id="vitrine-titre" className="mt-3 text-3xl font-black leading-tight tracking-tight text-ink sm:text-5xl">
            {marketingHero.title}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">{marketingHero.text}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Button
              asChild
              className="h-auto min-h-11 rounded-xl bg-brand-gradient px-6 py-3 text-base font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
            >
              <Link to={marketingHero.primaryCta.href}>{marketingHero.primaryCta.label}</Link>
            </Button>
            <Button
              asChild
              variant="outline"
              className="h-auto min-h-11 rounded-xl border-brand-100 bg-white px-6 py-3 text-base font-bold text-brand hover:bg-brand-50 hover:text-brand"
            >
              <a href={marketingHero.secondaryCta.href}>{marketingHero.secondaryCta.label}</a>
            </Button>
          </div>
        </div>
        <div className="min-w-0">
          <ProductVisual variant="hero" />
        </div>
      </div>
    </section>
  );
}
