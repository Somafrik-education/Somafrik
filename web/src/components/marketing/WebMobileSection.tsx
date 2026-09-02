import { marketingProductVisual, marketingWebMobile } from "../../data/marketingContent";
import { MobileProductVisual } from "./MobileProductVisual";

export function WebMobileSection() {
  return (
    <section id={marketingWebMobile.id} className="scroll-mt-28 border-y border-line bg-slate-50/80" aria-labelledby="web-mobile-titre">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-16">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingWebMobile.eyebrow}</p>
        <h2 id="web-mobile-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingWebMobile.title}
        </h2>
        <div className="mt-10 grid gap-12 lg:grid-cols-2 lg:items-start">
          <article className="min-w-0">
            <h3 className="text-base font-black text-ink">{marketingWebMobile.web.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{marketingWebMobile.web.text}</p>
            <figure className="mt-6 min-w-0">
              <div className="overflow-hidden rounded-2xl bg-white shadow-[0_18px_40px_-24px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80">
                <img
                  src={marketingProductVisual.src}
                  alt={marketingProductVisual.alt}
                  width={marketingProductVisual.width}
                  height={marketingProductVisual.height}
                  loading="lazy"
                  decoding="async"
                  className="h-auto w-full object-contain object-top"
                />
              </div>
              <figcaption className="mt-3 text-sm font-medium leading-relaxed text-slate-500">
                {marketingProductVisual.caption}
              </figcaption>
            </figure>
          </article>
          <article className="min-w-0">
            <h3 className="text-base font-black text-ink">{marketingWebMobile.mobile.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{marketingWebMobile.mobile.text}</p>
            <div className="mt-6 min-w-0">
              <MobileProductVisual />
            </div>
          </article>
        </div>
      </div>
    </section>
  );
}
