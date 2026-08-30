import { marketingBusinessProofs } from "../../data/marketingContent";

export function BusinessProofsSection() {
  return (
    <section
      id={marketingBusinessProofs.id}
      className="scroll-mt-28 border-y border-line bg-slate-50/70"
      aria-labelledby="preuves-titre"
    >
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="text-xs font-bold uppercase tracking-wide text-brand">{marketingBusinessProofs.eyebrow}</p>
        <h2 id="preuves-titre" className="mt-2 max-w-2xl text-2xl font-black tracking-tight text-ink sm:text-3xl">
          {marketingBusinessProofs.title}
        </h2>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600">{marketingBusinessProofs.intro}</p>

        <div className="mt-12 space-y-16">
          {marketingBusinessProofs.items.map((item, index) => {
            const reverse = index % 2 === 1;
            return (
              <article key={item.id} className="grid items-center gap-8 md:grid-cols-2 md:gap-12">
                <div className={`min-w-0 ${reverse ? "md:order-2" : ""}`}>
                  <p className="text-xs font-bold uppercase tracking-wide text-brand">{item.domain}</p>
                  <h3 className="mt-2 text-xl font-black tracking-tight text-ink">{item.title}</h3>
                  <p className="mt-3 max-w-md text-sm font-medium leading-relaxed text-slate-600">{item.description}</p>
                </div>
                <figure className={`min-w-0 ${reverse ? "md:order-1" : ""}`}>
                  <div className="mx-auto w-[11.5rem] sm:w-[12.5rem] md:mx-0 md:w-[13rem]">
                    <div className="rounded-[1.45rem] border border-slate-800/70 bg-white p-[3px] shadow-[0_16px_36px_-20px_rgba(15,23,42,0.45)]">
                      <img
                        src={item.src}
                        alt={item.alt}
                        width={item.width}
                        height={item.height}
                        loading="lazy"
                        decoding="async"
                        className="h-auto w-full rounded-[1.25rem] object-contain"
                      />
                    </div>
                    <figcaption className="mt-3 text-sm font-medium text-slate-500">{item.caption}</figcaption>
                  </div>
                </figure>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
