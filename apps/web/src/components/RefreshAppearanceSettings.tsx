import RefreshIndicatorGlyph from "./RefreshIndicatorGlyph.js";
import { REFRESH_BIRDS, REFRESH_COLORS, resolveRefreshColor, useRefreshAppearance } from "../lib/refreshAppearance.js";

export default function RefreshAppearanceSettings() {
  const [appearance, updateAppearance] = useRefreshAppearance();

  return (
    <section aria-labelledby="refresh-appearance-heading" className="mb-4 border-y border-gray-200 py-3">
      <div className="mb-3">
        <h2 id="refresh-appearance-heading" className="text-sm font-semibold text-gray-900">Refresh indicator</h2>
        <p className="mt-1 text-xs leading-5 text-gray-500">Choose a bird or the classic arrows, then pick its color. Saved on this device.</p>
      </div>
      <div role="radiogroup" aria-label="Refresh indicator" className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {REFRESH_BIRDS.map((option) => {
          const selected = appearance.bird === option.id;
          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-label={option.label}
              aria-checked={selected}
              onClick={() => updateAppearance({ bird: option.id })}
              className={`flex min-h-[72px] min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1.5 py-2 text-center transition-colors ${selected ? "bg-gray-50" : "border-gray-200 bg-white hover:bg-gray-50"}`}
              style={{ borderColor: selected ? resolveRefreshColor(option.id, appearance.color) : undefined }}
            >
              <span className="flex h-9 items-center justify-center">
                <RefreshIndicatorGlyph bird={option.id} color={resolveRefreshColor(option.id, appearance.color)} size={34} />
              </span>
              <span className="text-[10px] font-medium leading-tight text-gray-700">{option.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-4">
        <h3 className="mb-2 text-xs font-semibold text-gray-700">Refresh color</h3>
        <div role="group" aria-label="Refresh color" className="flex flex-wrap items-center gap-3">
          {REFRESH_COLORS.map((option) => {
            const selected = appearance.color?.toLowerCase() === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-label={`${option.label} refresh color`}
                aria-pressed={selected}
                onClick={() => updateAppearance({ color: option.value })}
                className="grid h-10 w-10 place-items-center rounded-full"
              >
                <span
                  aria-hidden="true"
                  className="h-7 w-7 rounded-full border border-black/10"
                  style={{ backgroundColor: option.value, outline: selected ? `2px solid ${appearance.color}` : undefined, outlineOffset: 2 }}
                />
              </button>
            );
          })}
          <label className="flex items-center gap-2 text-xs font-medium text-gray-700">
            Custom
            <input
              type="color"
              aria-label="Custom refresh color"
              value={resolveRefreshColor(appearance.bird, appearance.color)}
              onChange={(event) => updateAppearance({ color: event.currentTarget.value })}
              className="h-9 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
          <button
            type="button"
            aria-label="Reset to bird colors"
            aria-pressed={appearance.color === null}
            onClick={() => updateAppearance({ color: null })}
            className="text-xs font-medium text-gray-600 underline decoration-gray-300 underline-offset-2 hover:text-gray-900"
          >
            Reset colors
          </button>
        </div>
      </div>
    </section>
  );
}