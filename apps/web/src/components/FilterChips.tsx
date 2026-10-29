export interface FilterChip<T extends string> {
  value: T;
  label: string;
  locked?: boolean;
  activeClass?: string;
  inactiveClass?: string;
}

/** Pill row; the parent decides whether chips select exclusively or toggle independently. */
export default function FilterChips<T extends string>({
  label,
  heading,
  chips,
  isActive,
  onSelect,
  disabled,
}: {
  label: string;
  heading?: string;
  chips: FilterChip<T>[];
  isActive: (value: T) => boolean;
  onSelect: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div role="group" aria-label={label} className="mb-4">
      {heading && <p className="mb-1.5 px-0.5 text-xs font-medium text-gray-500">{heading}</p>}
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((chip) => {
          const active = isActive(chip.value);
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={active}
              disabled={disabled || chip.locked}
              title={chip.locked ? "Always on" : undefined}
              onClick={() => onSelect(chip.value)}
              className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[13px] font-semibold transition-[background-color,color,border-color,box-shadow,transform] duration-200 ease-out active:scale-95 motion-reduce:transition-none ${
                active
                  ? `${chip.activeClass ?? "!border-black !bg-black !text-white"} shadow-[0_2px_8px_-2px_rgba(15,23,42,0.28)]`
                  : (chip.inactiveClass ?? "border-gray-200 bg-white text-gray-600 hover:bg-gray-50")
              } ${chip.locked ? "opacity-70" : ""}`}
            >
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
