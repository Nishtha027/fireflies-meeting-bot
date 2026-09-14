"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  changePassword,
  deleteAccount,
  logout,
  NetworkError,
  updateAccount,
} from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import { Modal } from "@/components/Modal";

function SettingsSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="h-10 w-full rounded-lg bg-slate-100" />
      <div className="h-4 w-24 rounded bg-slate-200" />
      <div className="h-10 w-full rounded-lg bg-slate-100" />
    </div>
  );
}

function AccountSection() {
  const { user, setUser } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (user) {
      setName(user.name ?? "");
      setEmail(user.email ?? "");
    }
  }, [user]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const result = await updateAccount(name.trim(), email.trim());
      // Reflects immediately in the sidebar's "Logged in as X" - no page
      // reload, no second GET /auth/me round trip.
      setUser({
        authenticated: true,
        id: result.id,
        name: result.name,
        email: result.email,
      });
      setSuccess(true);
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong saving your account.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (!user) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-slate-900">Account</h2>
        <div className="mt-4">
          <SettingsSkeleton />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-slate-900">Account</h2>
      <p className="mt-1 text-sm text-slate-500">
        Your name and email address.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="settings-name" className="text-sm font-medium text-slate-700">
            Name
          </label>
          <input
            id="settings-name"
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSuccess(false);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="settings-email" className="text-sm font-medium text-slate-700">
            Email
          </label>
          <input
            id="settings-email"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setSuccess(false);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && !error && (
          <p className="text-sm text-emerald-600">Account details saved.</p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving || !name.trim() || !email.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </section>
  );
}

function ChangePasswordSection() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }

    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong changing your password.");
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-sm font-semibold text-slate-900">Change password</h2>
      <p className="mt-1 text-sm text-slate-500">
        Requires your current password.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="current-password" className="text-sm font-medium text-slate-700">
            Current password
          </label>
          <input
            id="current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => {
              setCurrentPassword(e.target.value);
              setSuccess(false);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="new-password" className="text-sm font-medium text-slate-700">
            New password
          </label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value);
              setSuccess(false);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="text-sm font-medium text-slate-700">
            Confirm new password
          </label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value);
              setSuccess(false);
            }}
            className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-indigo-300 focus:bg-white focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {success && !error && (
          <p className="text-sm text-emerald-600">Password changed.</p>
        )}

        <div>
          <button
            type="submit"
            disabled={saving || !currentPassword || !newPassword || !confirmPassword}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Changing…" : "Change password"}
          </button>
        </div>
      </form>
    </section>
  );
}

function DangerZoneSection() {
  const [showModal, setShowModal] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmChecked, setConfirmChecked] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function closeModal() {
    if (deleting) return;
    setShowModal(false);
    setPassword("");
    setConfirmChecked(false);
    setError(null);
  }

  async function handleDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount(password);
      // The backend already cleared the session cookie - this call is
      // best-effort local cleanup only, mirroring the sidebar's logout.
      try {
        await logout();
      } catch {
        // Ignore - the account (and its session) are already gone server-side.
      }
      // A full navigation, not router.replace(): AppShell re-checks auth on
      // every client-side route change, and its own gate can briefly race
      // this one (still holding the pre-deletion "authed" state for a tick)
      // and win, sending the user to "/" and dropping the ?deleted=1 query
      // along the way. A hard navigation sidesteps that entirely - AppShell
      // just mounts fresh on /login, which is a public path with nothing to
      // gate.
      window.location.href = "/login?deleted=1";
    } catch (err) {
      if (err instanceof NetworkError || err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong deleting your account.");
      }
      setDeleting(false);
    }
  }

  return (
    <section className="rounded-xl border-2 border-red-200 bg-red-50 p-6">
      <h2 className="text-sm font-semibold text-red-900">Danger Zone</h2>
      <p className="mt-1 text-sm text-red-700">
        Permanently delete your account, every meeting you've captured, its
        transcripts and summaries, and its recorded audio. This cannot be
        undone.
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
        >
          Delete my account
        </button>
      </div>

      {showModal && (
        <Modal title="Delete your account?" onClose={closeModal}>
          <p className="text-sm text-slate-600">
            This permanently deletes your account and every meeting you own -
            transcripts, summaries, action items, and recorded audio. There
            is no undo. Enter your password and confirm below to proceed.
          </p>

          <div className="mt-4">
            <label htmlFor="delete-password" className="text-sm font-medium text-slate-700">
              Password
            </label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-red-300 focus:bg-white focus:outline-none"
            />
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-red-600 focus:ring-red-500"
            />
            Yes, delete everything
          </label>

          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={deleting}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleting || !password || !confirmChecked}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {deleting ? "Deleting…" : "Permanently delete"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
        Settings
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Manage your account and preferences.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        <AccountSection />
        <ChangePasswordSection />
        <DangerZoneSection />
      </div>
    </main>
  );
}
