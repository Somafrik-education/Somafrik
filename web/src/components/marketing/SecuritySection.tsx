import { marketingSecurity } from "../../data/marketingContent";

export function SecuritySection() {
  return (
    <section
      id={marketingSecurity.id}
      className="scroll-mt-28 border-y border-line bg-slate-50/80"
      aria-labelledby="securite-titre"
    >
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingSecurity.eyebrow}</p>
        <h2 id="securite-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingSecurity.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">{marketingSecurity.intro}</p>
        <ul className="mt-8 grid gap-4 md:grid-cols-3">
          {marketingSecurity.items.map((item) => (
            <li key={item.title} className="min-w-0 rounded-2xl border border-line bg-white p-5">
              <h3 className="text-base font-black text-ink">{item.title}</h3>
              <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{item.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
