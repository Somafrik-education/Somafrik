import { marketingFeatures } from "../../data/marketingContent";

export function FeaturesSection() {
  return (
    <section id="fonctionnalites" className="scroll-mt-28 bg-white" aria-labelledby="fonctionnalites-titre">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <h2 id="fonctionnalites-titre" className="max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          Les besoins couverts aujourd’hui
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-3">
          {marketingFeatures.map((group) => (
            <article key={group.title} className="min-w-0 rounded-2xl border border-line bg-slate-50/70 p-5">
              <h3 className="text-base font-black text-ink">{group.title}</h3>
              <ul className="mt-3 space-y-2">
                {group.items.map((item) => (
                  <li key={item} className="text-sm font-medium text-slate-600">
                    {item}
                  </li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
