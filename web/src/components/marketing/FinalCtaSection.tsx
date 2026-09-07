import { Link } from "react-router-dom";
import { Button } from "../ui/shadcn/button";
import { marketingFinalCta, marketingTrial } from "../../data/marketingContent";

export function FinalCtaSection() {
  return (
    <section id="acces" className="scroll-mt-28 border-t border-line bg-gradient-to-b from-brand-50 to-white" aria-labelledby="cta-final-titre">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 id="cta-final-titre" className="text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingFinalCta.title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">{marketingFinalCta.text}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            className="h-auto min-h-11 rounded-xl bg-brand-gradient px-8 py-3 text-base font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
          >
            <Link to={marketingFinalCta.cta.href}>{marketingFinalCta.cta.label}</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-auto min-h-11 rounded-xl border-brand-100 bg-white px-8 py-3 text-base font-bold text-brand hover:bg-brand-50 hover:text-brand"
          >
            <Link to={marketingTrial.href}>{marketingTrial.label}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
