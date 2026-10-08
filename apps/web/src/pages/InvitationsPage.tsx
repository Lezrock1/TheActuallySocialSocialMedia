import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "../lib/api.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { InlineSkeletonText } from "../components/LoadingSkeleton.js";
import { card, input, btnPrimary } from "../lib/ui.js";

interface InvitationStatus {
  activeCount: number;
  remaining: number;
  maxActive: number;
  maxUsesPerInvitation?: number;
}

async function fetchInvitationStatus(): Promise<InvitationStatus> {
  return apiFetch<InvitationStatus>("/invitations");
}

export default function InvitationsPage() {
  const queryClient = useQueryClient();
  const [inviteUrl, setInviteUrl] = useState("");
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: status } = useQuery({
    queryKey: ["invitations"],
    queryFn: fetchInvitationStatus,
  });

  async function createInvite() {
    setCreating(true);
    setError(null);
    setCopied(false);
    try {
      const invitation = await apiFetch<{ code: string; expiresAt: string }>(
        "/invitations",
        { method: "POST" }
      );
      const url = new URL("/register", window.location.origin);
      url.hash = new URLSearchParams({ invite: invitation.code }).toString();
      setInviteUrl(url.toString());
      setExpiresAt(invitation.expiresAt);
      await queryClient.invalidateQueries({ queryKey: ["invitations"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create invitation");
    } finally {
      setCreating(false);
    }
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
    } catch {
      setError("Could not copy. Select the invitation link and copy it manually.");
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-4 sm:py-8">
      <PageHeader title="Invite friends" />
      <NavBar />

      <section className={`${card} flex flex-col gap-3`}>
        <p className="text-sm text-gray-600">
          Each invitation link lets up to {status?.maxUsesPerInvitation ?? 5} friends join and expires after 14 days.
          Invited members can invite more friends themselves.
        </p>
        <p className="text-xs text-gray-500">
          {status
            ? `${status.remaining} of ${status.maxActive} active invitations available`
            : <InlineSkeletonText width="w-52" />}
        </p>
        <button
          onClick={() => void createInvite()}
          disabled={creating || !status?.remaining}
          className={btnPrimary}
        >
          {creating ? "Creating..." : "Create invitation link"}
        </button>
        {inviteUrl && (
          <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
            <label htmlFor="invite-link" className="text-xs font-medium text-gray-600">
              Invitation link
            </label>
            <input
              id="invite-link"
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.currentTarget.select()}
              className={input}
            />
            <p className="text-xs text-gray-500">
              Expires {expiresAt ? new Date(expiresAt).toLocaleString("en-US") : ""}. Up to {status?.maxUsesPerInvitation ?? 5} people can join with this link; share it only with people you trust.
            </p>
            <button onClick={() => void copyInvite()} className={btnPrimary}>
              {copied ? "Copied" : "Copy link"}
            </button>
          </div>
        )}
        {status?.remaining === 0 && (
          <p className="text-xs text-gray-500">
            Create more invitations after pending links have been fully used or expired.
          </p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>
    </div>
  );
}
