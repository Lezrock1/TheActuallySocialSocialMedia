import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { FeedItem, NotificationsPage as NotificationsPageData, UserNotification } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { activityList, activityRow, btnSecondary, formatActivityTime } from "../lib/ui.js";
import Avatar from "../components/Avatar.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PullToRefresh from "../components/PullToRefresh.js";
import { NotificationRowsSkeleton } from "../components/LoadingSkeleton.js";
import { EmptyState, ErrorState } from "../components/StateMessage.js";
import PreferenceSwitch from "../components/PreferenceSwitch.js";
import { ALERTS_UNREAD_ONLY_KEY, useListPreference } from "../lib/listPreferences.js";

async function fetchNotifications(cursor: string | null): Promise<NotificationsPageData> {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  return apiFetch<NotificationsPageData>(`/notifications?${params.toString()}`);
}

function notificationText(notification: UserNotification): string {
  switch (notification.type) {
    case "post":
      return "shared a new post";
    case "close_friend_post":
      return "shared a new post with close friends";
    case "follow":
      return "started following you";
    case "comment":
      return "commented on your post";
    case "comment_reply":
      return "replied to your comment";
    case "comment_like":
      return "liked your comment";
    case "story_reaction":
      return `reacted to your story${notification.reactionEmoji ? ` ${notification.reactionEmoji}` : ""}`;
    case "mention":
      return "mentioned you";
    case "message":
      return "sent you a message";
    case "call":
      return "called you";
    case "live_room":
      return "started a Live Room you can join";
    case "snap":
      return "sent you a Snap";
    case "close_friend":
      return "added you as a close friend";
    case "circle_post":
      return "shared a new post with a circle you're in";
    case "circle_added":
      return "added you to a circle";
    case "meetup_response":
      return "is going to your meetup";
    case "meetup_update":
      return "updated a meetup you joined";
    case "meetup_cancelled":
      return "cancelled a meetup you joined";
  }
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const notificationsListRef = useRef<HTMLDivElement>(null);
  const [virtualScrollMargin, setVirtualScrollMargin] = useState(0);
  const [filter, setFilter] = useState<"all" | "friends">("all");
  const [unreadOnly, setUnreadOnly] = useListPreference(ALERTS_UNREAD_ONLY_KEY);
  const friendsActivity = useInfiniteQuery({
    queryKey: ["notifications", "friends-activity"],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => apiFetch<{ activities: Extract<FeedItem, { type: "follow" }>[]; nextCursor: string | null }>(`/notifications/friends-activity${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ""}`),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: filter === "friends",
  });
  const query = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const notifications = query.data?.pages.flatMap((page) => page.notifications) ?? [];
  const unreadCount = query.data?.pages[0]?.unreadCount ?? 0;
  const filteredNotifications = notifications.filter((notification) => !notification.dismissedAt && (!unreadOnly || !notification.readAt));

  useEffect(() => {
    function updateScrollMargin() {
      if (!notificationsListRef.current) return;
      const rect = notificationsListRef.current.getBoundingClientRect();
      setVirtualScrollMargin(rect.top + window.scrollY);
    }
    updateScrollMargin();
    window.addEventListener("resize", updateScrollMargin);
    window.addEventListener("orientationchange", updateScrollMargin);
    return () => {
      window.removeEventListener("resize", updateScrollMargin);
      window.removeEventListener("orientationchange", updateScrollMargin);
    };
  }, [notifications.length, filter, unreadOnly]);

  const rowVirtualizer = useWindowVirtualizer({
    count: filteredNotifications.length,
    estimateSize: () => 92,
    getItemKey: (index) => filteredNotifications[index]?.id ?? index,
    overscan: 6,
    scrollMargin: virtualScrollMargin,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const lastVirtual = virtualRows[virtualRows.length - 1];
    if (!lastVirtual || !query.hasNextPage || query.isFetchingNextPage) return;
    if (lastVirtual.index >= filteredNotifications.length - 1) {
      void query.fetchNextPage();
    }
  }, [filteredNotifications.length, query, virtualRows]);

  useEffect(() => {
    if (filteredNotifications.length > 0 || !query.hasNextPage || query.isFetchingNextPage || query.isLoading) return;
    void query.fetchNextPage();
  }, [filteredNotifications.length, query]);

  function updateUnreadBadge(delta: number) {
    queryClient.setQueryData<{ unreadCount: number; messageUnreadCount: number; feedUnreadCount: number }>(
      ["notifications", "unread-count"],
      (current) => {
        if (!current) return current;
        return { ...current, unreadCount: Math.max(0, current.unreadCount + delta) };
      }
    );
  }

  function markRead(notificationId: string) {
    const previous = queryClient.getQueryData<InfiniteData<NotificationsPageData>>(["notifications", "list"]);
    const decremented = Boolean(previous?.pages.some((page) => page.notifications.some(
      (notification) => notification.id === notificationId && !notification.readAt
    )));
    queryClient.setQueryData<InfiniteData<NotificationsPageData>>(["notifications", "list"], (current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page, pageIndex) => {
          const next = page.notifications.map((notification) => {
            if (notification.id !== notificationId) return notification;
            return { ...notification, readAt: notification.readAt ?? new Date().toISOString(), dismissedAt: new Date().toISOString() };
          });
          return {
            ...page,
            notifications: next,
            unreadCount: pageIndex === 0 && decremented ? Math.max(0, page.unreadCount - 1) : page.unreadCount,
          };
        }),
      };
    });
    if (decremented) updateUnreadBadge(-1);

    void apiFetch(`/notifications/${notificationId}/read`, { method: "POST" })
      .then(() => queryClient.invalidateQueries({ queryKey: ["notifications"] }))
      .catch(() => {
        if (previous) queryClient.setQueryData(["notifications", "list"], previous);
        if (decremented) updateUnreadBadge(1);
      });
  }

  async function markAllRead() {
    const previous = queryClient.getQueryData<InfiniteData<NotificationsPageData>>(["notifications", "list"]);
    const countBefore = previous?.pages[0]?.unreadCount ?? 0;
    if (previous) {
      queryClient.setQueryData<InfiniteData<NotificationsPageData>>(["notifications", "list"], {
        ...previous,
        pages: previous.pages.map((page, pageIndex) => ({
          ...page,
          unreadCount: pageIndex === 0 ? 0 : page.unreadCount,
          notifications: page.notifications.map((notification) =>
            notification.readAt ? notification : { ...notification, readAt: new Date().toISOString() }
          ),
        })),
      });
      if (countBefore > 0) updateUnreadBadge(-countBefore);
    }

    try {
      await apiFetch("/notifications/read-all", { method: "POST" });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "friends-activity"] }),
      ]);
    } catch {
      if (previous) queryClient.setQueryData(["notifications", "list"], previous);
      if (countBefore > 0) updateUnreadBadge(countBefore);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PullToRefresh onRefresh={() => Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications", "list"] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "unread-count"] }),
      ])} />
      <PageHeader title="Notifications" />
      <NavBar />

      <section aria-label="Alert controls" className="alerts-controls mb-4 space-y-3">
        <div role="group" aria-label="Alert views" className="segmented-control">
          <button type="button" aria-pressed={filter !== "friends"} onClick={() => setFilter("all")} className="segmented-option">Alerts</button>
          <button type="button" aria-label="Your friends activity" aria-pressed={filter === "friends"} onClick={() => setFilter("friends")} className="segmented-option">Friends activity</button>
        </div>
        {filter !== "friends" && <PreferenceSwitch label="Unread only" checked={unreadOnly} onChange={setUnreadOnly} tone="magenta" />}
        {unreadCount > 0 && <div className="flex min-h-11 items-center justify-between gap-3 border-b border-gray-200 pb-2">
          <p role="status" className="text-xs text-gray-500">
            {unreadCount} unread
          </p>
          <button type="button" onClick={() => void markAllRead()} className="alerts-command min-h-11 shrink-0 px-1 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#c0268a]">
            Mark all as read
          </button>
        </div>}
      </section>

      {filter === "friends" && <section aria-label="Your friends activity">
        {friendsActivity.isPending && <NotificationRowsSkeleton rows={4} />}
        {friendsActivity.isError && <ErrorState onRetry={() => void friendsActivity.refetch()}>Could not load friends activity.</ErrorState>}
        <div className={activityList}>{friendsActivity.data?.pages.flatMap((page) => page.activities).map((activity) => <div key={activity.id} className={activityRow}>
          <Avatar avatarKey={activity.follower.avatarKey} username={activity.follower.username} size={40} />
          <span className="min-w-0 flex-1 text-sm"><Link className="font-semibold" to={`/u/${activity.follower.username}`}>@{activity.follower.username}</Link>{" followed "}<Link className="font-semibold" to={`/u/${activity.followee.username}`}>@{activity.followee.username}</Link><time className="mt-1 block text-xs text-gray-500">{formatActivityTime(activity.createdAt)}</time></span>
        </div>)}</div>
        {friendsActivity.isSuccess && !friendsActivity.data.pages[0]?.activities.length && <EmptyState icon="👥">No recent friends activity.</EmptyState>}
        {friendsActivity.hasNextPage && <button type="button" disabled={friendsActivity.isFetchingNextPage} onClick={() => void friendsActivity.fetchNextPage()} className={`${btnSecondary} mt-4 w-full`}>{friendsActivity.isFetchingNextPage ? "Loading..." : "Load more activity"}</button>}
      </section>}
      {filter !== "friends" && query.isLoading && <NotificationRowsSkeleton rows={6} />}
      {filter !== "friends" && query.isError && <ErrorState onRetry={() => void query.refetch()}>Could not load notifications.</ErrorState>}

      <div hidden={filter === "friends"} ref={notificationsListRef} className={activityList} style={{ position: "relative", height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualRows.map((virtualRow) => {
          const notification = filteredNotifications[virtualRow.index];
          if (!notification) return null;
          const target = notification.storyId
            ? `/?story=${encodeURIComponent(notification.storyId)}`
            : notification.type === "live_room"
            ? "/dms?view=live_rooms"
            : notification.postId
            ? `/post/${notification.postId}`
            : notification.conversationId
              ? `/dms?conversation=${notification.conversationId}`
              : notification.snapId
                ? "/snaps"
                : `/u/${notification.actor.username}`;
          return (
            <div
              key={notification.id}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              className="absolute left-0 top-0 w-full"
              style={{ transform: `translateY(${virtualRow.start - virtualScrollMargin}px)` }}
            >
              <Link
                data-notification-id={notification.id}
                to={target}
                onClick={() => markRead(notification.id)}
                className={`${activityRow} items-start ${
                  notification.readAt ? "" : "alert-unread-row"
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
                    {formatActivityTime(notification.createdAt)}
                  </time>
                </span>
                {!notification.readAt && (
                  <span aria-label="Unread" className="alert-unread-dot mt-1.5 h-2 w-2 shrink-0 rounded-full" />
                )}
              </Link>
            </div>
          );
        })}
      </div>

      {filter !== "friends" && !query.isLoading && !query.isError && filteredNotifications.length === 0 && (
        <EmptyState icon="🔔" hint={filter === "all" ? "Comments, replies and new followers show up here." : undefined}>
          {filter === "all" ? "No notifications yet." : "No notifications match this filter."}
        </EmptyState>
      )}
      {filter !== "friends" && query.hasNextPage && (
        <button
          onClick={() => void query.fetchNextPage()}
          disabled={query.isFetchingNextPage}
          className={`${btnSecondary} mt-4 w-full`}
        >
          {query.isFetchingNextPage ? "Loading older notifications..." : "Load older notifications"}
        </button>
      )}
    </div>
  );
}