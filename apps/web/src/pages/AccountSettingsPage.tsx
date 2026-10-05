import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { apiFetch } from "../lib/api.js";
import { useAuth } from "../auth/AuthContext.js";
import { deleteDeviceEncryptionKeys } from "../lib/encryption.js";
import { forgetDeviceEncryptionKeyRegistration } from "../lib/encryptionRegistration.js";
import NavBar from "../components/NavBar.js";
import PageHeader from "../components/PageHeader.js";
import { btnPrimary, card, input } from "../lib/ui.js";

interface AccountDetails {
  email: string;
  username: string;
}

type UsernameStatus = "same" | "checking" | "available" | "taken" | "invalid" | "error";

async function fetchAccountDetails(): Promise<AccountDetails> {
  return apiFetch<AccountDetails>("/auth/account");
}

export default function AccountSettingsPage() {
  const { user, updateUser } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const accountQuery = useQuery({
    queryKey: ["account-settings"],
    queryFn: fetchAccountDetails,
  });
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [accountPassword, setAccountPassword] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("same");
  const [accountSaving, setAccountSaving] = useState(false);
  const [accountError, setAccountError] = useState<string | null>(null);
  const [accountSaved, setAccountSaved] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSaved, setPasswordSaved] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountQuery.data) return;
    setEmail(accountQuery.data.email);
    setUsername(accountQuery.data.username);
  }, [accountQuery.data]);

  const currentUsername = accountQuery.data?.username ?? "";
  const usernameChanged = username.trim().toLowerCase() !== currentUsername.toLowerCase();
  const usernameValid = /^[a-zA-Z0-9_]{3,30}$/.test(username.trim());
  const accountChanged = !!accountQuery.data && (
    email.trim().toLowerCase() !== accountQuery.data.email.toLowerCase() ||
    usernameChanged
  );

  useEffect(() => {
    if (!accountQuery.data || !usernameChanged) {
      setUsernameStatus("same");
      return;
    }
    if (!usernameValid) {
      setUsernameStatus("invalid");
      return;
    }

    let cancelled = false;
    setUsernameStatus("checking");
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ username: username.trim() });
      void apiFetch<{ available: boolean }>(`/auth/username-availability?${params.toString()}`)
        .then((result) => {
          if (!cancelled) setUsernameStatus(result.available ? "available" : "taken");
        })
        .catch(() => {
          if (!cancelled) setUsernameStatus("error");
        });
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [accountQuery.data, username, usernameChanged, usernameValid]);

  const usernameStatusText = {
    same: "",
    checking: "Checking availability…",
    available: "Username is available.",
    taken: "That username is already taken.",
    invalid: "Use 3–30 letters, numbers, or underscores.",
    error: "Could not check availability. Try again shortly.",
  }[usernameStatus];
  const usernameStatusColor = usernameStatus === "available"
    ? "text-green-700"
    : usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "error"
      ? "text-red-600"
      : "text-gray-500";
  const canSaveAccount = accountChanged && !!accountPassword && usernameValid &&
    (!usernameChanged || usernameStatus === "available");

  async function saveAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSaveAccount) return;
    setAccountSaving(true);
    setAccountError(null);
    setAccountSaved(false);
    try {
      const result = await apiFetch<{
        user: { id: string; username: string; displayName: string | null; avatarKey: string | null; createdAt: string };
        email: string;
      }>("/auth/account", {
        method: "PATCH",
        body: JSON.stringify({ email: email.trim(), username: username.trim(), currentPassword: accountPassword }),
      });
      updateUser(result.user);
      setEmail(result.email);
      setUsername(result.user.username);
      setAccountPassword("");
      setUsernameStatus("same");
      setAccountSaved(true);
      queryClient.setQueryData<AccountDetails>(["account-settings"], {
        email: result.email,
        username: result.user.username,
      });
    } catch (caught) {
      setAccountError(caught instanceof Error ? caught.message : "Could not save account details.");
    } finally {
      setAccountSaving(false);
    }
  }

  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    setPasswordSaved(false);
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }
    setPasswordSaving(true);
    try {
      await apiFetch("/auth/password", {
        method: "PATCH",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setPasswordSaved(true);
    } catch (caught) {
      setPasswordError(caught instanceof Error ? caught.message : "Could not change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function deleteAccount(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!user || deleteConfirmation !== "DELETE") return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await apiFetch("/auth/account", {
        method: "DELETE",
        body: JSON.stringify({ currentPassword: deletePassword, confirmation: deleteConfirmation }),
      });

      let localCleanupWarning = false;
      try {
        await deleteDeviceEncryptionKeys(user.id);
        forgetDeviceEncryptionKeyRegistration(user.id);
        if ("serviceWorker" in navigator) {
          const registration = await navigator.serviceWorker.getRegistration("/");
          const subscription = await registration?.pushManager.getSubscription();
          if (subscription) await subscription.unsubscribe();
        }
      } catch {
        localCleanupWarning = true;
      }

      queryClient.clear();
      updateUser(null);
      navigate("/login", {
        replace: true,
        state: { accountDeleted: true, localCleanupWarning },
      });
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : "Could not delete this account.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg px-4 py-4 sm:py-8">
      <PageHeader title="Settings" />
      <NavBar />
      <p className="mb-4 text-sm leading-5 text-gray-500">Manage the details you use to sign in.</p>

      {accountQuery.isLoading && <p className="py-6 text-center text-sm text-gray-500">Loading account…</p>}
      {accountQuery.isError && <p role="alert" className="mb-4 text-sm text-red-600">Could not load account settings.</p>}

      {accountQuery.data && (
        <>
          <form onSubmit={(event) => void saveAccount(event)} className={`${card} mb-4 flex flex-col gap-4`}>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Email and username</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">Your username is unique, regardless of capitalization. A new email takes effect immediately. Confirm with your current password to save changes.</p>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              Email address
              <input type="email" required autoComplete="email" value={email} onChange={(event) => { setEmail(event.target.value); setAccountSaved(false); }} className={input} />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              Username
              <span className="flex items-center gap-1">
                <span className="text-gray-400">@</span>
                <input required autoComplete="username" minLength={3} maxLength={30} value={username} onChange={(event) => { setUsername(event.target.value); setAccountSaved(false); }} className={`${input} min-w-0 flex-1`} />
              </span>
              {usernameChanged && <span aria-live="polite" className={`text-xs font-normal ${usernameStatusColor}`}>{usernameStatusText}</span>}
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              Current password
              <input type="password" required autoComplete="current-password" value={accountPassword} onChange={(event) => setAccountPassword(event.target.value)} className={input} />
            </label>

            {accountError && <p role="alert" className="text-sm text-red-600">{accountError}</p>}
            {accountSaved && <p role="status" className="text-sm text-green-700">Account details saved.</p>}
            <button type="submit" disabled={!canSaveAccount || accountSaving} className={`${btnPrimary} min-h-11 w-full disabled:cursor-not-allowed`}>
              {accountSaving ? "Saving…" : "Save account details"}
            </button>
          </form>

          <form onSubmit={(event) => void changePassword(event)} className={`${card} flex flex-col gap-4`}>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Change password</h2>
              <p className="mt-1 text-xs leading-5 text-gray-500">Use at least 8 characters.</p>
            </div>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              Current password
              <input type="password" required autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              New password
              <input type="password" required minLength={8} autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className={input} />
            </label>
            <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
              Confirm new password
              <input type="password" required minLength={8} autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className={input} />
            </label>
            {passwordError && <p role="alert" className="text-sm text-red-600">{passwordError}</p>}
            {passwordSaved && <p role="status" className="text-sm text-green-700">Password changed.</p>}
            <button type="submit" disabled={passwordSaving || !currentPassword || newPassword.length < 8 || !confirmPassword} className={`${btnPrimary} min-h-11 w-full disabled:cursor-not-allowed`}>
              {passwordSaving ? "Updating…" : "Update password"}
            </button>
          </form>

          <section className="mt-6 rounded-xl border border-red-200 bg-white p-4 shadow-sm">
            <div>
              <h2 className="text-base font-semibold text-red-700">Delete account</h2>
              <p className="mt-1 text-sm leading-5 text-gray-600">
                Permanently removes your profile, posts, comments, messages, Snaps, follows, settings, and uploaded files from the live service. One-to-one conversations with you are removed for both participants; group messages you sent are removed.
              </p>
              <p className="mt-2 text-xs leading-5 text-gray-500">
                Offline backups may retain database copies until those backups are removed. Copies or notifications already delivered to other people cannot be recalled, and this cannot erase data saved on their devices.
              </p>
            </div>
            <form onSubmit={(event) => void deleteAccount(event)} className="mt-4 flex flex-col gap-3">
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
                Current password
                <input
                  type="password"
                  required
                  autoComplete="current-password"
                  value={deletePassword}
                  onChange={(event) => setDeletePassword(event.target.value)}
                  className={input}
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-800">
                Type DELETE to confirm
                <input
                  required
                  autoComplete="off"
                  value={deleteConfirmation}
                  onChange={(event) => setDeleteConfirmation(event.target.value)}
                  className={input}
                />
              </label>
              {deleteError && <p role="alert" className="text-sm text-red-600">{deleteError}</p>}
              <button
                type="submit"
                disabled={deleting || !deletePassword || deleteConfirmation !== "DELETE"}
                className="min-h-11 w-full rounded-lg bg-red-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deleting ? "Deleting account…" : "Delete account permanently"}
              </button>
            </form>
          </section>
        </>
      )}
    </div>
  );
}