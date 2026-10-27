import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.js";
import { solarTimes, useThemeSchedule } from "../lib/theme.js";
import { btnSecondary, input } from "../lib/ui.js";
import PreferenceSwitch from "./PreferenceSwitch.js";

export default function ThemeScheduleSettings() {
  const [schedule, update] = useThemeSchedule();
  const [latitude, setLatitude] = useState(String(schedule.latitude ?? ""));
  const [longitude, setLongitude] = useState(String(schedule.longitude ?? ""));
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const client = useQueryClient();
  const zoneSave = useMutation({
    mutationFn: (timezone: string) => apiFetch("/notifications/preferences", { method: "PATCH", body: JSON.stringify({ timezone }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["notification-preferences"] }),
  });
  const zones = [...new Set(["UTC", schedule.timeZone, ...((Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.("timeZone") ?? [])])].sort();
  const times = solarTimes(schedule);
  const time = (date: Date | null) => date && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en", { timeZone: schedule.timeZone, hour: "2-digit", minute: "2-digit" }).format(date) : null;
  function saveLocation(event: React.FormEvent) {
    event.preventDefault();
    const north = Number(latitude), east = Number(longitude);
    if (!latitude.trim() || !longitude.trim() || !Number.isFinite(north) || !Number.isFinite(east) || Math.abs(north) > 90 || Math.abs(east) > 180) {
      setError("Enter a valid latitude and longitude."); return;
    }
    update({ latitude: north, longitude: east }); setError(null);
  }
  function locate() {
    if (!navigator.geolocation) { setError("Location is unavailable. Enter coordinates instead."); return; }
    setLocating(true); setError(null);
    navigator.geolocation.getCurrentPosition(({ coords }) => {
      setLatitude(String(Number(coords.latitude.toFixed(4)))); setLongitude(String(Number(coords.longitude.toFixed(4))));
      update({ latitude: coords.latitude, longitude: coords.longitude }); setLocating(false);
    }, () => { setError("Location access is unavailable. Enter coordinates instead."); setLocating(false); }, { timeout: 10000, maximumAge: 3600000 });
  }
  return <section aria-labelledby="time-appearance-heading" className="mb-4 border-y border-gray-200 py-3">
    <h2 id="time-appearance-heading" className="mb-3 text-sm font-semibold text-gray-900">Time and automatic appearance</h2>
    <label className="block text-xs font-medium text-gray-600">Time zone
      <select aria-label="Time zone" value={schedule.timeZone} className={`${input} mt-1 w-full`} disabled={zoneSave.isPending}
        onChange={(event) => {
          const previous = schedule.timeZone; const next = event.target.value;
          update({ timeZone: next });
          zoneSave.mutate(next, { onError: () => update({ timeZone: previous }) });
        }}>
        {zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll("_", " ")}</option>)}
      </select>
    </label>
    {zoneSave.isError && <p role="alert" className="mt-1 text-xs text-red-600">Could not save your time zone. Try again.</p>}
    <div className="mt-3"><PreferenceSwitch label="Sunset to sunrise" checked={schedule.mode === "sun"} onChange={(enabled) => update({ mode: enabled ? "sun" : "manual" })} /></div>
    {schedule.mode === "sun" && <div className="mt-2 space-y-3">
      <p role="status" className="text-xs leading-5 text-gray-500">
        {!times ? "Location required for sunset and sunrise." : time(times.sunset) && time(times.sunrise)
          ? `Sunset ${time(times.sunset)} · Sunrise ${time(times.sunrise)}` : "Polar day or night: appearance follows the sun's position."}
      </p>
      <button type="button" className={`${btnSecondary} text-xs`} disabled={locating} onClick={locate}>{locating ? "Locating..." : "Use my location"}</button>
      <form onSubmit={saveLocation} className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-xs text-gray-600">Latitude<input aria-label="Latitude" type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} className={`${input} mt-1 w-full`} /></label>
        <label className="min-w-0 flex-1 text-xs text-gray-600">Longitude<input aria-label="Longitude" type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} className={`${input} mt-1 w-full`} /></label>
        <button type="submit" className={`${btnSecondary} text-xs`}>Save location</button>
      </form>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>}
  </section>;
}