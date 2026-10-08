import { memo } from "react";
import { mediaUrl } from "../lib/upload.js";

// Images are protected from drag/save/long-press (deterrent only; the browser still receives the file).
function Avatar({
  avatarKey,
  username,
  size = 36,
}: {
  avatarKey: string | null;
  username: string;
  size?: number;
}) {
  if (avatarKey) {
    return (
      <img
        src={mediaUrl(avatarKey)}
        alt={username}
        loading="eager"
        decoding="async"
        fetchPriority="high"
        draggable={false}
        onContextMenu={(event) => event.preventDefault()}
        width={size}
        height={size}
        style={{ width: size, height: size, WebkitTouchCallout: "none" }}
        className="pointer-events-none shrink-0 select-none rounded-full bg-gray-200 object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 select-none items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-xs font-semibold text-white"
    >
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default memo(Avatar);
