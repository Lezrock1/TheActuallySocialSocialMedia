import PageHeader from "../components/PageHeader.js";
import NavBar from "../components/NavBar.js";
import BackgroundSettings from "../components/BackgroundSettings.js";
import { card } from "../lib/ui.js";
import { useThemePreference } from "../lib/theme.js";

function ThemePreview({ dark, selected }: { dark: boolean; selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`block w-full overflow-hidden rounded-xl border p-2 transition-colors ${selected ? "border-[#007AFF] ring-2 ring-[#007AFF]/15" : "border-gray-200"} ${dark ? "bg-[#151820]" : "bg-[#f7f7f8]"}`}
    >
      <span className="mb-2 block h-1.5 w-10 rounded-full bg-gray-400/60" />
      <span className="block rounded-lg p-2" style={{ backgroundColor: dark ? "#222630" : "#ffffff" }}>
        <span className={`mb-1 block h-1 w-14 rounded-full ${dark ? "bg-gray-400/70" : "bg-gray-300"}`} />
        <span className={`block h-1 w-9 rounded-full ${dark ? "bg-gray-500/60" : "bg-gray-200"}`} />
      </span>
    </span>
  );
}

export default function AppearanceSettingsPage() {
  const [theme, setTheme] = useThemePreference();

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Appearance" />
      <NavBar />
      <p className="mb-4 text-sm leading-6 text-gray-500">
        Set the app-wide theme and customize the backgrounds behind each area.
      </p>

      <section aria-labelledby="theme-heading" className={`${card} mb-4`}>
        <div className="mb-3">
          <h2 id="theme-heading" className="text-sm font-semibold text-gray-900">Color theme</h2>
          <p className="mt-1 text-xs leading-5 text-gray-500">Applied across the app and saved on this device. Page backgrounds are dimmed in dark mode and restored in light mode.</p>
        </div>
        <div role="group" aria-label="Color theme" className="grid grid-cols-2 gap-3">
          {(["light", "dark"] as const).map((option) => {
            const selected = theme === option;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                aria-pressed={selected}
                className="min-w-0 text-left"
              >
                <ThemePreview dark={option === "dark"} selected={selected} />
                <span className="mt-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-sm font-medium text-gray-800">{option === "light" ? "Light" : "Dark"}</span>
                  <span className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${selected ? "border-[#007AFF] bg-[#007AFF] text-white" : "border-gray-300 text-transparent"}`}>
                    ✓
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <BackgroundSettings />
    </div>
  );
}
