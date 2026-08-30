import { marketingMobileVisuals } from "../../data/marketingContent";

export function MobileProductVisual() {
  return (
    <ul className="flex snap-x snap-mandatory gap-4 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] md:grid md:grid-cols-2 md:justify-items-center md:overflow-visible lg:flex lg:justify-center lg:overflow-visible">
      {marketingMobileVisuals.map((visual, index) => (
        <li
          key={visual.src}
          className={`w-[10.75rem] shrink-0 snap-center sm:w-[11.5rem] md:w-[12rem] ${
            index === 1 ? "lg:-translate-y-3" : "lg:translate-y-2"
          }`}
        >
          <figure className="min-w-0">
            <div className="rounded-[1.55rem] border-2 border-slate-900 bg-slate-900 p-[3px] shadow-[0_14px_30px_-18px_rgba(15,23,42,0.55)]">
              <img
                src={visual.src}
                alt={visual.alt}
                width={visual.width}
                height={visual.height}
                loading="lazy"
                decoding="async"
                className="h-auto w-full rounded-[1.3rem]"
              />
            </div>
            <figcaption className="mt-2 text-center text-xs font-semibold text-slate-500">{visual.caption}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}
