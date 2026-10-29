import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";

function Bone({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={`skeleton ${className.includes("inline-block") ? "" : "block"} ${className}`} style={style} />;
}

// Deterministic widths so placeholders look organic without flickering between renders.
function width(index: number, min: number, spread: number): CSSProperties {
  return { width: `${min + ((index * 17) % spread)}%` };
}

function PostCardSkeleton({ media = false, lines = 2 }: { media?: boolean; lines?: number }) {
  return (
    <div className="skeleton-card p-4">
      <div className="mb-3 flex items-center gap-3">
        <Bone className="skeleton-round h-10 w-10 shrink-0" />
        <div className="flex-1 space-y-2">
          <Bone className="h-3 w-28" />
          <Bone className="h-2.5 w-20" />
        </div>
      </div>
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, line) => <Bone key={line} className="h-3" style={line === lines - 1 ? { width: "62%" } : undefined} />)}
      </div>
      {media && <Bone className="mt-3 h-44 w-full rounded-lg sm:h-56" />}
      <div className="mt-3 flex gap-5">
        <Bone className="h-4 w-10" />
        <Bone className="h-4 w-10" />
        <Bone className="h-4 w-10" />
      </div>
    </div>
  );
}

export function CardListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => <PostCardSkeleton key={index} media={index % 2 === 0} lines={index % 2 === 0 ? 2 : 3} />)}
    </div>
  );
}

export function PersonRowsSkeleton({ rows = 5, action = true }: { rows?: number; action?: boolean }) {
  return (
    <div aria-hidden="true" className="skeleton-card overflow-hidden">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
          <Bone className="skeleton-round h-[42px] w-[42px] shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3" style={width(index, 34, 28)} />
            <Bone className="h-2.5" style={width(index + 2, 22, 20)} />
          </div>
          {action && <Bone className="skeleton-round h-8 w-16 shrink-0" />}
        </div>
      ))}
    </div>
  );
}

export function NotificationRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-card overflow-hidden">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-start gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
          <Bone className="skeleton-round h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <Bone className="h-3" style={width(index, 62, 30)} />
            {index % 3 === 0 && <Bone className="h-2.5" style={width(index + 1, 38, 24)} />}
            <Bone className="h-2 w-12" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ListRowsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="skeleton-card overflow-hidden">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 border-b border-gray-100 px-4 py-3 last:border-b-0">
          <Bone className="skeleton-round h-11 w-11 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3" style={width(index, 30, 26)} />
            <Bone className="h-2.5" style={width(index + 3, 18, 16)} />
          </div>
        </div>
      ))}
    </div>
  );
}

// Chat-style rows (large avatar, name and preview on the left, time on the right).
export function ConversationRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex min-h-[84px] items-center gap-3 px-1 py-3">
          <Bone className="skeleton-round h-12 w-12 shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Bone className="h-3.5" style={width(index, 40, 30)} />
            <Bone className="h-3" style={width(index + 2, 56, 30)} />
          </div>
          <Bone className="h-2.5 w-8 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function StoriesRowSkeleton() {
  return (
    <div aria-hidden="true" className="mb-4 flex gap-4 overflow-hidden pb-2">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex w-16 shrink-0 flex-col items-center gap-2">
          <Bone className="skeleton-round h-16 w-16" />
          <Bone className="h-2.5 w-12" />
        </div>
      ))}
    </div>
  );
}

export function ProfileHeaderSkeleton() {
  return (
    <div aria-hidden="true" className="skeleton-card mb-6 p-5">
      <div className="flex items-center gap-4">
        <Bone className="skeleton-round h-20 w-20 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2.5">
          <Bone className="h-5 w-36" />
          <Bone className="h-3 w-24" />
          <Bone className="h-3 w-full" />
          <Bone className="h-3 w-2/3" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        <Bone className="h-10 rounded-xl" />
        <Bone className="h-10 rounded-xl" />
      </div>
    </div>
  );
}

export function ProfileSkeleton() {
  return (
    <>
      <ProfileHeaderSkeleton />
      <div aria-hidden="true" className="mb-3 flex gap-2">
        <Bone className="skeleton-round h-8 w-16" />
        <Bone className="skeleton-round h-8 w-20" />
        <Bone className="skeleton-round h-8 w-20" />
      </div>
      <CardListSkeleton rows={2} />
    </>
  );
}

export function ThreadSkeleton() {
  return (
    <div aria-hidden="true" className="flex flex-col gap-3">
      <div className="border-l-2 border-gray-200 pl-3"><PostCardSkeleton media lines={3} /></div>
      <div className="skeleton-card space-y-3 p-4">
        <Bone className="h-14 w-full rounded-xl" />
        <Bone className="ml-auto h-9 w-20 rounded-xl" />
      </div>
      <Bone className="mt-1 h-3 w-20" />
      <PostCardSkeleton lines={2} />
      <PostCardSkeleton lines={1} />
    </div>
  );
}

export function SettingsSkeleton({ sections = 2 }: { sections?: number }) {
  return (
    <div aria-hidden="true" className="space-y-4">
      {Array.from({ length: sections }, (_, section) => (
        <div key={section} className="skeleton-card p-4">
          <Bone className="mb-4 h-4 w-32" />
          <div className="space-y-4">
            {Array.from({ length: 3 }, (_, row) => (
              <div key={row} className="flex items-center gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <Bone className="h-3" style={width(row + section, 36, 26)} />
                  <Bone className="h-2.5" style={width(row + 2, 52, 30)} />
                </div>
                <Bone className="skeleton-round h-6 w-11 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function InlineSkeletonText({ width: widthClass = "w-32" }: { width?: string }) {
  return <Bone className={`inline-block h-3 align-middle ${widthClass}`} />;
}

function HeaderSkeleton() {
  return (
    <div aria-hidden="true" className="mb-2 flex items-center justify-between">
      <Bone className="h-6 w-32" />
      <div className="flex items-center gap-2">
        <Bone className="skeleton-round h-9 w-24" />
        <Bone className="skeleton-round h-9 w-9" />
        <Bone className="skeleton-round h-9 w-9" />
      </div>
    </div>
  );
}

function DesktopNavSkeleton() {
  return (
    <div aria-hidden="true" className="mx-auto mb-3 hidden h-[41px] items-center gap-6 border-b border-gray-200 pb-2 sm:flex">
      <Bone className="h-4 w-14" />
      <Bone className="h-4 w-14" />
      <Bone className="h-4 w-20" />
    </div>
  );
}

function SearchBarSkeleton() {
  return <Bone className="skeleton-round mb-3 h-11 w-full" />;
}

function routeBody(pathname: string) {
  if (pathname === "/") {
    return (
      <>
        <StoriesRowSkeleton />
        <Bone className="mb-4 h-24 w-full rounded-xl" />
        <CardListSkeleton rows={3} />
      </>
    );
  }
  if (pathname.startsWith("/snaps")) {
    return (
      <>
        <SearchBarSkeleton />
        <ConversationRowsSkeleton rows={6} />
      </>
    );
  }
  if (pathname.startsWith("/dms")) {
    return (
      <div className="lg:max-w-[380px]">
        <SearchBarSkeleton />
        <div className="mb-3 flex gap-2">
          <Bone className="skeleton-round h-8 w-12" />
          <Bone className="skeleton-round h-8 w-16" />
          <Bone className="skeleton-round h-8 w-16" />
        </div>
        <ConversationRowsSkeleton rows={6} />
      </div>
    );
  }
  if (pathname.startsWith("/notifications")) {
    return (
      <>
        <Bone className="mb-4 h-10 w-full rounded-full" />
        <NotificationRowsSkeleton rows={6} />
      </>
    );
  }
  if (pathname.startsWith("/people")) {
    return (
      <>
        <SearchBarSkeleton />
        <Bone className="mb-3 h-3.5 w-32" />
        <PersonRowsSkeleton rows={5} />
      </>
    );
  }
  if (pathname.startsWith("/circles")) {
    return (
      <>
        <Bone className="mb-4 h-3 w-full" />
        <Bone className="mb-4 h-3 w-2/3" />
        <ListRowsSkeleton rows={3} />
      </>
    );
  }
  if (pathname.startsWith("/u/")) return <ProfileSkeleton />;
  if (pathname.startsWith("/post/")) return <ThreadSkeleton />;
  if (pathname.startsWith("/tags/")) return <CardListSkeleton rows={3} />;
  if (pathname.startsWith("/settings") || pathname.startsWith("/invitations") || pathname.startsWith("/dashboard")) return <SettingsSkeleton sections={2} />;
  return <ListRowsSkeleton rows={4} />;
}

// Shown while the app boots or a page chunk loads; mirrors the shape of the page that is about to appear.
export function RouteSkeleton() {
  const { pathname } = useLocation();
  const wide = pathname.startsWith("/dms");
  return (
    <div aria-busy="true" className={`mx-auto px-4 py-4 sm:py-8 ${wide ? "max-w-7xl" : "max-w-2xl"}`}>
      <HeaderSkeleton />
      <DesktopNavSkeleton />
      {routeBody(pathname)}
    </div>
  );
}

export const AppBootSkeleton = RouteSkeleton;
