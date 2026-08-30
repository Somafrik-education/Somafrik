import { marketingWebMobile } from "../../data/marketingContent";

export function WebMobileSection() {
  return (
    <section id={marketingWebMobile.id} className="scroll-mt-28 border-y border-line bg-slate-50/80" aria-labelledby="web-mobile-titre">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingWebMobile.eyebrow}</p>
        <h2 id="web-mobile-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingWebMobile.title}
        </h2>
        <div className="mt-10 grid gap-8 md:grid-cols-2">
          <article className="min-w-0">
            <h3 className="text-base font-black text-ink">{marketingWebMobile.web.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{marketingWebMobile.web.text}</p>
          </article>
          <article className="min-w-0">
            <h3 className="text-base font-black text-ink">{marketingWebMobile.mobile.title}</h3>
            <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600">{marketingWebMobile.mobile.text}</p>
          </article>
        </div>
      </div>
    </section>
  );
}
