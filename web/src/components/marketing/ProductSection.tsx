import { marketingProduct } from "../../data/marketingContent";
import { ProductVisual } from "./ProductVisual";

export function ProductSection() {
  return (
    <section id={marketingProduct.id} className="scroll-mt-28 bg-white" aria-labelledby="produit-titre">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div className="min-w-0">
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
        <ProductVisual variant="product" />
      </div>
    </section>
  );
}
