import { marketingProduct } from "../../data/marketingContent";

export function ProductSection() {
  return (
    <section id={marketingProduct.id} className="scroll-mt-24 bg-white" aria-labelledby="produit-titre">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingProduct.eyebrow}</p>
          <h2 id="produit-titre" className="mt-2 text-2xl font-black tracking-tight text-ink sm:text-3xl">
            {marketingProduct.title}
          </h2>
          <p className="mt-4 text-base leading-relaxed text-slate-600">{marketingProduct.text}</p>
          <ul className="mt-6 space-y-3">
            {marketingProduct.points.map((point) => (
              <li key={point} className="text-sm font-semibold leading-relaxed text-slate-700">
                {point}
              </li>
            ))}
          </ul>
        </div>
        <figure className="rounded-2xl border border-line bg-slate-50 p-8">
          <div className="flex min-h-48 items-center justify-center rounded-xl bg-white ring-1 ring-line">
            <p className="max-w-xs px-4 text-center text-sm font-semibold leading-relaxed text-muted">
              Emplacement réservé à une capture réelle de l’interface web Somafrik.
            </p>
          </div>
          <figcaption className="sr-only">
            Zone réservée pour une capture d’écran réelle de Somafrik, sans image fictive.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
