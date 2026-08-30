import { Link } from "react-router-dom";
import { Button } from "../ui/shadcn/button";
import { marketingFinalCta } from "../../data/marketingContent";

export function FinalCtaSection() {
  return (
    <section id="acces" className="scroll-mt-24 bg-white" aria-labelledby="cta-final-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="cta-final-titre" className="text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingFinalCta.title}
        </h2>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-600">{marketingFinalCta.text}</p>
        <div className="mt-8">
          <Button
            asChild
            className="h-auto min-h-11 rounded-xl bg-brand-gradient px-6 py-3 text-base font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
          >
            <Link to={marketingFinalCta.cta.href}>{marketingFinalCta.cta.label}</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
