import { marketingFeatures } from "../../data/marketingContent";

export function FeaturesSection() {
  return (
    <section id="fonctionnalites" className="scroll-mt-24 bg-white" aria-labelledby="fonctionnalites-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="fonctionnalites-titre" className="max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          Les besoins couverts aujourd’hui
        </h2>
        <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
          {marketingFeatures.map((group) => (
            <article key={group.title} className="min-w-0">
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
