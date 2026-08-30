import { marketingAudiences } from "../../data/marketingContent";

export function AudiencesSection() {
  return (
    <section id="utilisateurs" className="scroll-mt-24 bg-white" aria-labelledby="utilisateurs-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <h2 id="utilisateurs-titre" className="max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          Pensé d’abord pour l’établissement
        </h2>
        <ul className="mt-10 grid gap-8 sm:grid-cols-2">
          {marketingAudiences.map((audience) => (
            <li key={audience.title} className="min-w-0">
              <h3 className="text-base font-black text-ink">{audience.title}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{audience.description}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
