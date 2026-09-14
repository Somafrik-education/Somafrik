import { Link } from "react-router-dom";
import { Button } from "../ui/shadcn/button";
import { marketingFinalCta, marketingLogin, marketingTrial } from "../../data/marketingContent";
import { marketingDemo } from "../../data/demoMarketing";
import { publicDemoEnabled } from "../../lib/featureFlags";

export function FinalCtaSection() {
  const title = publicDemoEnabled ? "Découvrez Somafrik avant de lancer votre essai" : marketingFinalCta.title;
  const text = publicDemoEnabled
    ? "Explorez un établissement fictif dans un environnement séparé, puis demandez un mois d’essai si Somafrik correspond à vos besoins."
    : marketingFinalCta.text;

  return (
    <section id="acces" className="scroll-mt-28 border-t border-line bg-gradient-to-b from-brand-50 to-white" aria-labelledby="cta-final-titre">
      <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6 sm:py-20">
        <h2 id="cta-final-titre" className="text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {title}
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600">{text}</p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button
            asChild
            className="h-auto min-h-11 rounded-xl bg-brand-gradient px-8 py-3 text-base font-bold text-white shadow-brand hover:bg-brand-gradient hover:opacity-95"
          >
            <Link to={publicDemoEnabled ? marketingDemo.href : marketingFinalCta.cta.href}>
              {publicDemoEnabled ? marketingDemo.ctaLabel : marketingFinalCta.cta.label}
            </Link>
          </Button>
          <Button
            asChild
            variant="outline"
            className="h-auto min-h-11 rounded-xl border-brand-100 bg-white px-8 py-3 text-base font-bold text-brand hover:bg-brand-50 hover:text-brand"
          >
            <Link to={marketingTrial.href}>{marketingTrial.label}</Link>
          </Button>
        </div>
        {publicDemoEnabled ? (
          <p className="mt-5 text-sm text-slate-500">
            Vous avez déjà un compte ?{" "}
            <Link to={marketingLogin.href} className="font-bold text-brand underline">
              {marketingLogin.ctaLabel}
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
