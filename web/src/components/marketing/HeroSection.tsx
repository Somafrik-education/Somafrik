import { Link } from "react-router-dom";
import { Button } from "../ui/shadcn/button";
import { marketingHero } from "../../data/marketingContent";

export function HeroSection() {
  return (
    <section className="border-b border-line bg-gradient-to-b from-white to-brand-50" aria-labelledby="vitrine-titre">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingHero.eyebrow}</p>
        <h1 id="vitrine-titre" className="mt-3 max-w-3xl text-3xl font-black leading-tight tracking-tight text-ink sm:text-5xl">
          {marketingHero.title}
        </h1>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-slate-600 sm:text-lg">{marketingHero.text}</p>
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
    </section>
  );
}
