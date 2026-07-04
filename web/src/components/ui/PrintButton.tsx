import { Button } from "./Button";

interface PrintButtonProps {
  label?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
  className?: string;
  /** Titre du document appliqué le temps de l'impression (nom de fichier PDF proposé). */
  documentTitle?: string;
  disabled?: boolean;
}

export function PrintButton({
  label = "Imprimer",
  variant = "secondary",
  size = "sm",
  className = "",
  documentTitle,
  disabled,
}: PrintButtonProps) {
  function handlePrint() {
    if (documentTitle) {
      const previous = document.title;
      document.title = documentTitle;
      const restore = () => {
        document.title = previous;
        window.removeEventListener("afterprint", restore);
      };
      window.addEventListener("afterprint", restore);
    }
    window.print();
  }

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={disabled}
      onClick={handlePrint}
      className={`no-print ${className}`}
      aria-label={label}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4"
        aria-hidden="true"
      >
        <path d="M6 9V2h12v7" />
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
        <rect x="6" y="14" width="12" height="8" rx="1" />
      </svg>
      {label}
    </Button>
  );
}
