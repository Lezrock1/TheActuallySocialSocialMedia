export default function ApiUnavailablePage({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
        <h1 className="text-xl font-semibold text-gray-900">Server temporarily unavailable</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          InTouch cannot reach the API right now. Check your connection and try again.
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 min-h-11 rounded-xl bg-black px-4 text-sm font-semibold text-white hover:bg-gray-800"
        >
          Retry
        </button>
      </section>
    </main>
  );
}
