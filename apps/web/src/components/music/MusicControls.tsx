import { useState } from "react";
import { MusicTastePanel, NowPlayingProfile } from "./MusicProfile.js";
import { MusicMixesProfile } from "./Mixes.js";

export function MusicIcon() {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18V5l12-2v13M9 9l12-2" /><ellipse cx="6" cy="18" rx="3" ry="3" /><ellipse cx="18" cy="16" rx="3" ry="3" /></svg>;
}

export default function MusicControls({ username, isOwnProfile, canViewStatus = true }: {
  username: string;
  isOwnProfile: boolean;
  canViewStatus?: boolean;
}) {
  const [tab, setTab] = useState<"playing" | "taste" | "mixes">("playing");
  return (
    <div className="min-w-0">
      <div role="tablist" aria-label="Music features" className="segmented-control mb-3">
        {([["playing", "Now playing"], ["taste", "Music taste"], ["mixes", "Mixes & sets"]] as const).map(([value, label]) => (
          <button key={value} id={`music-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls={`music-panel-${value}`} onClick={() => setTab(value)} className="segmented-option">{label}</button>
        ))}
      </div>
      <div id="music-panel-playing" role="tabpanel" aria-labelledby="music-tab-playing" hidden={tab !== "playing"}>
        <NowPlayingProfile username={username} isOwnProfile={isOwnProfile} canViewStatus={canViewStatus} />
      </div>
      <div id="music-panel-taste" role="tabpanel" aria-labelledby="music-tab-taste" hidden={tab !== "taste"}>
        <MusicTastePanel username={username} isOwnProfile={isOwnProfile} />
      </div>
      <div id="music-panel-mixes" role="tabpanel" aria-labelledby="music-tab-mixes" hidden={tab !== "mixes"}>
        <MusicMixesProfile username={username} isOwnProfile={isOwnProfile} />
      </div>
    </div>
  );
}