import { marketingSecurity } from "../../data/marketingContent";

export function SecuritySection() {
  return (
    <section id={marketingSecurity.id} className="scroll-mt-28 border-y border-line bg-slate-50/80" aria-labelledby="securite-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingSecurity.eyebrow}</p>
        <h2 id="securite-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingSecurity.title}
        </h2>
        <ul className="mt-8 max-w-3xl space-y-4">
          {marketingSecurity.items.map((item) => (
            <li key={item} className="text-sm font-medium leading-relaxed text-slate-700">
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
