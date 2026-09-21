import { Eye, EyeOff } from "lucide-react";

type PasswordVisibilityButtonProps = {
  visible: boolean;
  onToggle: () => void;
  showLabel: string;
  hideLabel: string;
  className?: string;
  disabled?: boolean;
};

export function PasswordVisibilityButton({
  visible,
  onToggle,
  showLabel,
  hideLabel,
  className = "top-1/2 -translate-y-1/2",
  disabled = false,
}: PasswordVisibilityButtonProps) {
  const label = visible ? hideLabel : showLabel;
  const Icon = visible ? EyeOff : Eye;

  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={visible}
      title={label}
      disabled={disabled}
      onClick={onToggle}
      className={`absolute right-2 inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:pointer-events-none disabled:opacity-50 ${className}`}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </button>
  );
}
