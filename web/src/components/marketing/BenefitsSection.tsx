import { marketingBenefits } from "../../data/marketingContent";

export function BenefitsSection() {
  return (
    <section id="benefices" className="scroll-mt-28 border-y border-line bg-slate-50/80" aria-labelledby="benefices-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="benefices-titre" className="max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          Ce que Somafrik apporte à votre établissement
        </h2>
        <ul className="mt-10 grid gap-8 sm:grid-cols-2">
          {marketingBenefits.map((benefit) => (
            <li key={benefit.title} className="min-w-0">
              <h3 className="text-base font-black text-ink">{benefit.title}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{benefit.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
