function SkeletonLine({ className }: { className: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-gray-200/80 ${className}`} />;
}

export function AppBootSkeleton() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <SkeletonLine className="mb-4 h-7 w-28" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <section key={index} className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
            <div className="mb-3 flex items-center gap-3">
              <SkeletonLine className="h-10 w-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <SkeletonLine className="h-3 w-28" />
                <SkeletonLine className="h-3 w-20" />
              </div>
            </div>
            <SkeletonLine className="mb-2 h-3 w-full" />
            <SkeletonLine className="mb-2 h-3 w-11/12" />
            <SkeletonLine className="h-36 w-full" />
          </section>
        ))}
      </div>
    </div>
  );
}

export function CardListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-hidden="true">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="rounded-xl border border-gray-200 bg-white p-4 shadow-[0_2px_12px_rgba(15,23,42,0.05)]">
          <div className="mb-3 flex items-center gap-3">
            <SkeletonLine className="h-9 w-9 rounded-full" />
            <div className="flex-1 space-y-2">
              <SkeletonLine className="h-3 w-24" />
              <SkeletonLine className="h-3 w-32" />
            </div>
          </div>
          <SkeletonLine className="mb-2 h-3 w-full" />
          <SkeletonLine className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function InlineSkeletonText({ width = "w-32" }: { width?: string }) {
  return <span aria-hidden="true" className={`inline-block h-3 animate-pulse rounded bg-gray-200/80 ${width}`} />;
}
