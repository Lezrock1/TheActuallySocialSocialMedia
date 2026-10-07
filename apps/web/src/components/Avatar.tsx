import { memo } from "react";
import { mediaUrl } from "../lib/upload.js";

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
        loading="lazy"
        decoding="async"
        style={{ width: size, height: size }}
        className="shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      style={{ width: size, height: size }}
      className="flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gray-700 to-gray-900 text-xs font-semibold text-white"
    >
      {username.slice(0, 2).toUpperCase()}
    </div>
  );
}

export default memo(Avatar);
