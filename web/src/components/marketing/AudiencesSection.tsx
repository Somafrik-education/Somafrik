import { marketingAudiences, marketingAudiencesSection } from "../../data/marketingContent";

export function AudiencesSection() {
  return (
    <section
      id={marketingAudiencesSection.id}
      className="scroll-mt-28 bg-white"
      aria-labelledby="utilisateurs-titre"
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingAudiencesSection.eyebrow}</p>
        <h2 id="utilisateurs-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingAudiencesSection.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">{marketingAudiencesSection.intro}</p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 sm:gap-5">
          {marketingAudiences.map((audience) => (
            <li key={audience.title} className="min-w-0 rounded-2xl border border-line bg-slate-50/70 p-5">
              <h3 className="text-base font-black text-ink">{audience.title}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{audience.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
