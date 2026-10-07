import { memo, useEffect } from "react";
import { mediaUrl, preloadMediaKeys } from "../lib/upload.js";

function Avatar({
  avatarKey,
  username,
  size = 36,
  priority = "auto",
}: {
  avatarKey: string | null;
  username: string;
  size?: number;
  priority?: "auto" | "high" | "low";
}) {
  useEffect(() => {
    if (!avatarKey || priority === "low") return;
    preloadMediaKeys([avatarKey], { priority: priority === "high" ? "high" : "low", addHint: false });
  }, [avatarKey, priority]);

  if (avatarKey) {
    const eager = priority === "high" || (priority === "auto" && size >= 32);
    return (
      <img
        src={mediaUrl(avatarKey)}
        alt={username}
        loading={eager ? "eager" : "lazy"}
        decoding="async"
        fetchPriority={priority === "high" ? "high" : priority === "low" ? "low" : "auto"}
        width={size}
        height={size}
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
