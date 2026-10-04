import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import type { NotificationsPage as NotificationsPageData, UserNotification } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { btnSecondary, card } from "../lib/ui.js";
import Avatar from "../components/Avatar.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";

async function fetchNotifications(cursor: string | null): Promise<NotificationsPageData> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch<NotificationsPageData>(`/notifications?${params.toString()}`);
}

function notificationText(notification: UserNotification): string {
  switch (notification.type) {
    case "follow":
      return "started following you";
    case "comment":
      return "commented on your post";
    case "comment_reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "mention":
      return "mentioned you";
    case "message":
      return "sent you a message";
    case "snap":
      return "sent you a Snap";
    case "close_friend":
      return "added you as a close friend";
  }
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const query = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const notifications = query.data?.pages.flatMap((page) => page.notifications) ?? [];
  const unreadCount = query.data?.pages[0]?.unreadCount ?? 0;

  async function markAllRead() {
    await apiFetch("/notifications/read-all", { method: "POST" });
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
      queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
    ]);
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4 sm:py-8">
      <PageHeader title="Notifications" />
      <NavBar />

      <div className="mb-3 flex min-h-10 items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          {unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up"}
        </p>
        {unreadCount > 0 && (
          <button onClick={() => void markAllRead()} className={btnSecondary}>
            Mark all as read
          </button>
        )}
      </div>

      {query.isLoading && <p className="py-6 text-center text-sm text-gray-500">Loading notifications...</p>}
      {query.isError && <p role="alert" className="py-6 text-center text-sm text-red-600">Could not load notifications.</p>}

      <div className="flex flex-col gap-2">
        {notifications.map((notification) => {
          const target = notification.postId
            ? `/post/${notification.postId}`
            : notification.conversationId
              ? `/dms?conversation=${notification.conversationId}`
              : notification.snapId
                ? "/snaps"
                : `/u/${notification.actor.username}`;
          return (
            <Link
              key={notification.id}
              to={target}
              className={`${card} flex min-w-0 items-start gap-3 py-3 hover:bg-gray-50 ${
                notification.readAt ? "" : "border-blue-200 bg-blue-50/50"
              }`}
            >
              <Avatar
                avatarKey={notification.actor.avatarKey}
                username={notification.actor.username}
                size={40}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm leading-5 text-gray-800">
                  <strong>@{notification.actor.username}</strong>{" "}
                  {notificationText(notification)}
                </span>
                {notification.commentText && (
                  <span className="mt-1 block truncate text-xs text-gray-500">
                    {notification.commentText}
                  </span>
                )}
                <time className="mt-1 block text-[11px] text-gray-400">
                  {new Date(notification.createdAt).toLocaleString("en-US")}
                </time>
              </span>
              {!notification.readAt && (
                <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
              )}
            </Link>
          );
        })}
      </div>

      {!query.isLoading && !query.isError && notifications.length === 0 && (
        <p className="py-12 text-center text-sm text-gray-500">No notifications yet.</p>
      )}
      {query.hasNextPage && (
        <button
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className={`${btnSecondary} mt-4 w-full`}
        >
          {query.isFetchingNextPage ? "Loading..." : "Load older notifications"}
        </button>
      )}
    </div>
  );
}