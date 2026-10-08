import { useState } from "react";
import { audienceToValue, useCircles, valueToAudience } from "../lib/circles.js";
import type { Audience } from "../lib/circles.js";
import CircleMemberManagerSheet from "./CircleMemberManagerSheet.js";

export default function AudiencePicker({
  value,
  onChange,
  className = "",
  tone = "light",
  showManageLink = true,
}: {
  value: Audience;
  onChange: (audience: Audience) => void;
  className?: string;
  tone?: "light" | "dark";
  showManageLink?: boolean;
}) {
  const { data } = useCircles();
  const [manageOpen, setManageOpen] = useState(false);
  const circles = data?.circles ?? [];
  const selected = audienceToValue(value);
  const selectedCircle = value.visibility === "circle"
    ? circles.find((circle) => circle.id === value.circleId)
    : undefined;
  const known = selected === "public" || selected === "close_friends" || circles.some((circle) => `circle:${circle.id}` === selected);

  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-2 ${className}`}>
      <label className="sr-only" htmlFor="audience-picker">Who can see this</label>
      <select
        id="audience-picker"
        value={known ? selected : "public"}
        onChange={(event) => onChange(valueToAudience(event.target.value))}
        className={`min-w-0 max-w-full rounded-xl border px-3 py-1.5 text-sm font-medium focus:outline-none focus:ring-4 ${
          tone === "dark"
            ? "border-white/30 bg-black/40 text-white focus:ring-white/20"
            : "border-gray-200 bg-white text-gray-800 focus:border-[#007AFF] focus:ring-[#007AFF]/10"
        }`}
      >
        <option value="public">Public</option>
        <option value="close_friends">Close friends</option>
        {circles.length > 0 && (
          <optgroup label="Your circles">
            {circles.map((circle) => (
              <option key={circle.id} value={`circle:${circle.id}`}>
                {circle.name} ({circle.memberCount})
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {showManageLink && (
          <button
            type="button"
            onClick={() => setManageOpen(true)}
            className={`shrink-0 text-xs font-medium hover:underline ${tone === "dark" ? "text-white/80" : "text-blue-600"}`}
          >
            Manage
          </button>
      )}
        <CircleMemberManagerSheet open={manageOpen} onClose={() => setManageOpen(false)} />
        <span className={`w-full text-[10px] leading-4 ${tone === "dark" ? "text-white/55" : "text-gray-500"}`} aria-live="polite">
          {selectedCircle
            ? `${selectedCircle.memberCount} members + you can see this.`
            : value.visibility === "close_friends"
              ? "Only your Close Friends can see this share."
              : "Anyone can see this share."}
        </span>
    </div>
  );
}
