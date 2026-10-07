import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-10 sm:py-16">
      <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-[0_8px_30px_rgba(15,23,42,0.08)]">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">404</p>
        <h1 className="mt-1 text-xl font-semibold text-gray-900">Page not found</h1>
        <p className="mt-2 text-sm leading-6 text-gray-600">
          This link does not exist or has moved.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link to="/" className="min-h-10 rounded-xl bg-black px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">Go to feed</Link>
          <Link to="/dms" className="min-h-10 rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Open messages</Link>
        </div>
      </section>
    </main>
  );
}
