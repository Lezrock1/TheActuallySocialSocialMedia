import PageHeader from "../components/PageHeader.js";
import NavBar from "../components/NavBar.js";
import BackgroundSettings from "../components/BackgroundSettings.js";
import { card } from "../lib/ui.js";
import { useThemePreference } from "../lib/theme.js";
import PreferenceSwitch from "../components/PreferenceSwitch.js";
import FeedSourceSettings from "../components/FeedSourceSettings.js";
import { UNREAD_FIRST_KEY, useListPreference } from "../lib/listPreferences.js";

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
  const [unreadFirst, setUnreadFirst] = useListPreference(UNREAD_FIRST_KEY);
  const isDark = theme === "dark";

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Appearance" />
      <NavBar />
      <section className="mb-4 rounded-2xl border border-gray-200 bg-[linear-gradient(140deg,#f8fafc_0%,#ffffff_50%,#ecfeff_100%)] p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-700">Look and feel</p>
        <p className="mt-1 text-sm leading-6 text-gray-700">
          Set the app-wide theme and customize the backgrounds behind each area.
        </p>
        <div className="mt-3 rounded-xl border border-gray-200 bg-white p-3 text-xs text-gray-600">
          Theme preview: <span className="font-semibold text-gray-800">{isDark ? "Dark mode active" : "Light mode active"}</span>
        </div>
      </section>

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
                aria-label={option === "light" ? "Light" : "Dark"}
                onClick={() => setTheme(option)}
                aria-pressed={selected}
                className="min-w-0 text-left"
              >
                <ThemePreview dark={option === "dark"} selected={selected} />
                <span className="mt-2 flex items-center justify-between gap-2 px-1">
                  <span className="text-sm font-medium text-gray-800">{option === "light" ? "Light" : "Dark"}</span>
                  <span aria-hidden="true" className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${selected ? "border-[#007AFF] bg-[#007AFF] text-white" : "border-gray-300 text-transparent"}`}>
                    ✓
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="messages-settings-heading" className="mb-4 border-y border-gray-200 py-3">
        <h2 id="messages-settings-heading" className="mb-1 text-sm font-semibold text-gray-900">Messages</h2>
        <PreferenceSwitch label="Unread first" checked={unreadFirst} onChange={setUnreadFirst} />
      </section>
      <FeedSourceSettings />
      <BackgroundSettings />
    </div>
  );
}
