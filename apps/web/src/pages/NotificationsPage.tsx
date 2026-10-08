import { useEffect, useRef, useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import type { InfiniteData } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { NotificationsPage as NotificationsPageData, UserNotification } from "@app/shared";
import { apiFetch } from "../lib/api.js";
import { activityList, activityRow, btnSecondary, formatActivityTime } from "../lib/ui.js";
import Avatar from "../components/Avatar.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import PullToRefresh from "../components/PullToRefresh.js";
import { CardListSkeleton } from "../components/LoadingSkeleton.js";

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
      return "reacted to your story";
    case "mention":
      return "mentioned you";
    case "message":
      return "sent you a message";
    case "live_room":
      return "started a Live Room you can join";
    case "snap":
      return "sent you a Snap";
    case "close_friend":
      return "added you as a close friend";
  }
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const notificationsListRef = useRef<HTMLDivElement>(null);
  const [virtualScrollMargin, setVirtualScrollMargin] = useState(0);
  const query = useInfiniteQuery({
    queryKey: ["notifications", "list"],
    queryFn: ({ pageParam }) => fetchNotifications(pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const notifications = query.data?.pages.flatMap((page) => page.notifications) ?? [];
  const unreadCount = query.data?.pages[0]?.unreadCount ?? 0;

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
  }, [notifications.length]);

  const rowVirtualizer = useWindowVirtualizer({
    count: notifications.length,
    estimateSize: () => 92,
    getItemKey: (index) => notifications[index]?.id ?? index,
    overscan: 6,
    scrollMargin: virtualScrollMargin,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();

  useEffect(() => {
    const lastVirtual = virtualRows[virtualRows.length - 1];
    if (!lastVirtual || !query.hasNextPage || query.isFetchingNextPage) return;
    if (lastVirtual.index >= notifications.length - 1) {
      void query.fetchNextPage();
    }
  }, [notifications.length, query, virtualRows]);

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
    const decremented = Boolean(previous?.pages[0]?.notifications.some(
      (notification) => notification.id === notificationId && !notification.readAt
    ));
    queryClient.setQueryData<InfiniteData<NotificationsPageData>>(["notifications", "list"], (current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page, pageIndex) => {
          const next = page.notifications.map((notification) => {
            if (notification.id !== notificationId || notification.readAt) return notification;
            return { ...notification, readAt: new Date().toISOString() };
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

      {query.isLoading && <CardListSkeleton rows={3} />}
      {query.isError && <p role="alert" className="py-6 text-center text-sm text-red-600">Could not load notifications.</p>}

      <div ref={notificationsListRef} className={activityList} style={{ position: "relative", height: `${rowVirtualizer.getTotalSize()}px` }}>
        {virtualRows.map((virtualRow) => {
          const notification = notifications[virtualRow.index];
          if (!notification) return null;
          const target = notification.type === "live_room"
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
                to={target}
                onClick={() => { if (!notification.readAt) markRead(notification.id); }}
                className={`${activityRow} items-start ${
                  notification.readAt ? "" : "bg-blue-50/60 hover:bg-blue-50"
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
                  <span aria-label="Unread" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-600" />
                )}
              </Link>
            </div>
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
          {query.isFetchingNextPage ? "Loading older notifications..." : "Load older notifications"}
        </button>
      )}
    </div>
  );
}