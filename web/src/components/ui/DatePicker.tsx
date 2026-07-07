import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Calendar, ChevronLeft, ChevronRight, X } from "lucide-react";

interface DatePickerProps {
  id?: string;
  /** Valeur au format ISO YYYY-MM-DD (identique à `<input type="date">`). */
  value?: string;
  /** Renvoie la nouvelle valeur au format YYYY-MM-DD ("" si effacée). */
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  className?: string;
}

const WEEKDAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"];
const MONTHS = [
  "Janvier",
  "Février",
  "Mars",
  "Avril",
  "Mai",
  "Juin",
  "Juillet",
  "Août",
  "Septembre",
  "Octobre",
  "Novembre",
  "Décembre",
];

const pad = (value: number) => String(value).padStart(2, "0");

function parseISO(value?: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? "").trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  if (m < 0 || m > 11 || d < 1 || d > 31) return null;
  return { y, m, d };
}

function toISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`;
}

function formatDisplay(value?: string): string {
  const parsed = parseISO(value);
  if (!parsed) return "";
  return `${pad(parsed.d)}/${pad(parsed.m + 1)}/${parsed.y}`;
}

/** Sélecteur de date moderne (popover en portail, navigation rapide mois/année). */
export function DatePicker({
  id,
  value,
  onChange,
  required,
  disabled,
  readOnly,
  placeholder = "JJ/MM/AAAA",
  className = "",
}: DatePickerProps) {
  const today = useMemo(() => new Date(), []);
  const selected = useMemo(() => parseISO(value), [value]);

  const [open, setOpen] = useState(false);
  const [viewYear, setViewYear] = useState(selected?.y ?? today.getFullYear());
  const [viewMonth, setViewMonth] = useState(selected?.m ?? today.getMonth());
  const [position, setPosition] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => {
    const current = today.getFullYear();
    const start = current + 5;
    const end = current - 100;
    const list: number[] = [];
    for (let year = start; year >= end; year -= 1) list.push(year);
    if (selected && !list.includes(selected.y)) {
      list.push(selected.y);
      list.sort((a, b) => b - a);
    }
    return list;
  }, [today, selected]);

  const updatePosition = useCallback(() => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 300;
    const margin = 8;
    let left = rect.left;
    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin);
    }
    const estimatedHeight = 360;
    const openUp = rect.bottom + estimatedHeight > window.innerHeight && rect.top > estimatedHeight;
    const top = openUp ? rect.top - estimatedHeight - 4 : rect.bottom + 4;
    setPosition({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    const handleScrollOrResize = () => updatePosition();
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (popoverRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("scroll", handleScrollOrResize, true);
    window.addEventListener("resize", handleScrollOrResize);
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("scroll", handleScrollOrResize, true);
      window.removeEventListener("resize", handleScrollOrResize);
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, updatePosition]);

  function openPicker() {
    if (disabled || readOnly) return;
    setViewYear(selected?.y ?? today.getFullYear());
    setViewMonth(selected?.m ?? today.getMonth());
    setOpen(true);
  }

  function goToMonth(offset: number) {
    const next = new Date(viewYear, viewMonth + offset, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  }

  function selectDay(day: number) {
    onChange(toISO(viewYear, viewMonth, day));
    setOpen(false);
  }

  function selectToday() {
    onChange(toISO(today.getFullYear(), today.getMonth(), today.getDate()));
    setOpen(false);
  }

  function clear() {
    onChange("");
    setOpen(false);
  }

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const leadingBlanks = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7;
  const cells: (number | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, index) => index + 1),
  ];

  const display = formatDisplay(value);

  return (
    <>
      <button
        id={id}
        type="button"
        ref={triggerRef}
        onClick={openPicker}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`input-base flex items-center justify-between gap-2 text-left ${
          disabled || readOnly ? "cursor-not-allowed bg-slate-50" : "cursor-pointer"
        } ${className}`}
      >
        <span className={display ? "text-ink" : "text-muted"}>{display || placeholder}</span>
        <span className="flex items-center gap-1">
          {display && !required && !readOnly && !disabled ? (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Effacer la date"
              onClick={(event) => {
                event.stopPropagation();
                clear();
              }}
              className="rounded p-0.5 text-muted transition hover:bg-slate-100 hover:text-ink"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <Calendar className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
        </span>
      </button>

      {open
        ? createPortal(
            <div
              ref={popoverRef}
              role="dialog"
              style={{ top: position.top, left: position.left, width: position.width }}
              className="fixed z-[60] rounded-2xl border border-line bg-white p-3 shadow-xl"
            >
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => goToMonth(-1)}
                  aria-label="Mois précédent"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink transition hover:bg-slate-100"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <select
                  value={viewMonth}
                  onChange={(event) => setViewMonth(Number(event.target.value))}
                  className="input-base flex-1 py-1.5 text-sm font-semibold"
                >
                  {MONTHS.map((month, index) => (
                    <option key={month} value={index}>
                      {month}
                    </option>
                  ))}
                </select>
                <select
                  value={viewYear}
                  onChange={(event) => setViewYear(Number(event.target.value))}
                  className="input-base w-24 py-1.5 text-sm font-semibold"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => goToMonth(1)}
                  aria-label="Mois suivant"
                  className="flex h-8 w-8 items-center justify-center rounded-lg text-ink transition hover:bg-slate-100"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="mt-3 grid grid-cols-7 gap-1">
                {WEEKDAYS.map((weekday) => (
                  <div
                    key={weekday}
                    className="py-1 text-center text-[11px] font-bold uppercase tracking-wide text-muted"
                  >
                    {weekday}
                  </div>
                ))}
                {cells.map((day, index) => {
                  if (day === null) return <div key={`blank-${index}`} />;
                  const isSelected =
                    selected?.y === viewYear && selected?.m === viewMonth && selected?.d === day;
                  const isToday =
                    today.getFullYear() === viewYear &&
                    today.getMonth() === viewMonth &&
                    today.getDate() === day;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => selectDay(day)}
                      className={`flex h-9 items-center justify-center rounded-lg text-sm transition ${
                        isSelected
                          ? "bg-brand font-bold text-white"
                          : isToday
                            ? "font-bold text-brand ring-1 ring-brand/40 hover:bg-brand-50"
                            : "text-ink hover:bg-brand-50"
                      }`}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
                <button
                  type="button"
                  onClick={selectToday}
                  className="rounded-lg px-2 py-1 text-xs font-semibold text-brand transition hover:bg-brand-50"
                >
                  Aujourd'hui
                </button>
                {!required ? (
                  <button
                    type="button"
                    onClick={clear}
                    className="rounded-lg px-2 py-1 text-xs font-semibold text-muted transition hover:bg-slate-100 hover:text-ink"
                  >
                    Effacer
                  </button>
                ) : null}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
