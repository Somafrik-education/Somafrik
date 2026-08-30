import { marketingHeroVisual, marketingProductVisual } from "../../data/marketingContent";

type ProductVisualVariant = "hero" | "product";

type ProductVisualProps = {
  variant: ProductVisualVariant;
};

export function ProductVisual({ variant }: ProductVisualProps) {
  const isHero = variant === "hero";
  const visual = isHero ? marketingHeroVisual : marketingProductVisual;

  return (
    <figure className="min-w-0">
      <div
        className={
          isHero
            ? "aspect-[16/9] overflow-hidden rounded-2xl bg-slate-100 shadow-[0_22px_50px_-24px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/80 lg:aspect-[1672/941]"
            : "overflow-hidden rounded-2xl bg-slate-100 shadow-[0_18px_40px_-24px_rgba(15,23,42,0.35)] ring-1 ring-slate-200/80"
        }
      >
        <img
          src={visual.src}
          alt={visual.alt}
          width={visual.width}
          height={visual.height}
          decoding="async"
          fetchPriority={isHero ? "high" : "auto"}
          loading={isHero ? "eager" : "lazy"}
          className={
            isHero
              ? "h-full w-full object-cover object-[52%_42%]"
              : "h-auto w-full object-contain object-top"
          }
        />
      </div>
      <figcaption className={isHero ? "sr-only" : "mt-3 text-sm font-medium leading-relaxed text-slate-500"}>
        {visual.caption}
      </figcaption>
    </figure>
  );
}
