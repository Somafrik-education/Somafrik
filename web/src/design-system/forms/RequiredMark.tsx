import { cn } from "../utils/cn";

type RequiredMarkProps = {
  className?: string;
};

/** Astérisque d'obligation : seul le `*` est rouge. Le label reste dans sa couleur. */
export function RequiredMark({ className }: RequiredMarkProps = {}) {
  return (
    <>
      <span className={cn("text-danger", className)} aria-hidden="true" data-testid="required-mark">
        {" *"}
      </span>
      <span className="sr-only"> (obligatoire)</span>
    </>
  );
}
