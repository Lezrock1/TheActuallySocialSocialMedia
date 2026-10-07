import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { card } from "../lib/ui.js";

const bestPracticeItems = [
  "For sensitive content, use only direct messages or Snaps marked with the green 'End-to-end encrypted' hint.",
  "If you see a red hint, that message path is not end-to-end encrypted.",
  "Avoid group chats for highly private topics.",
  "Do not enter passwords, one-time codes, or other secrets into AI tools.",
  "Use a long unique password and do not reuse it on other websites.",
];

const protectedNowItems = [
  "Connections use HTTPS (transport encryption).",
  "Sign-in uses an httpOnly session cookie (not readable by JavaScript).",
  "Rate limits protect login, registration, uploads, AI calls, and socket events against spam and brute-force attempts.",
  "Invitation checks run before expensive password hashing (better protection against CPU abuse).",
  "AI provider URLs are validated: no internal/private networks and no unsafe redirect chains.",
  "Personal AI API keys are encrypted at rest on the server.",
  "Block and privacy rules limit who can view your content or contact you.",
];

const missingItems = [
  "Group chats are currently not end-to-end encrypted.",
  "The API can still accept unencrypted message/Snap payloads from alternative clients (the official app sends encrypted payloads when possible).",
  "No two-factor authentication (2FA) yet.",
  "No device/session management page for revoking individual logins yet.",
  "When you send content to an AI provider, it leaves InTouch and follows that provider's policies.",
];

export default function SecuritySettingsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Security" />
      <NavBar />
      <p className="mb-4 text-sm leading-5 text-gray-500">
        Quick overview of how to communicate as safely as possible in InTouch, and where current limits still exist.
      </p>

      <section className={`${card} mb-4`}>
        <h2 className="text-base font-semibold text-gray-900">How to communicate with maximum safety</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-700">
          {bestPracticeItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={`${card} mb-4`}>
        <h2 className="text-base font-semibold text-gray-900">What is currently protected</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-700">
          {protectedNowItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>

      <section className={card}>
        <h2 className="text-base font-semibold text-gray-900">What is not available yet (or only partially)</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-gray-700">
          {missingItems.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
