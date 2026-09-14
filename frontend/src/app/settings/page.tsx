"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTheme } from "next-themes";
import { Laptop, Moon, Sun } from "lucide-react";
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
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="h-10 w-full rounded-lg bg-muted" />
      <div className="h-4 w-24 rounded bg-muted" />
      <div className="h-10 w-full rounded-lg bg-muted" />
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
      <section className="rounded-xl border border-border bg-card p-6">
        <h2 className="text-sm font-semibold text-foreground">Account</h2>
        <div className="mt-4">
          <SettingsSkeleton />
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">Account</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your name and email address.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="settings-name" className="text-sm font-medium text-foreground">
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
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="settings-email" className="text-sm font-medium text-foreground">
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
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && !error && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">Account details saved.</p>
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
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">Change password</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Requires your current password.
      </p>

      <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
        <div>
          <label htmlFor="current-password" className="text-sm font-medium text-foreground">
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
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="new-password" className="text-sm font-medium text-foreground">
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
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
        </div>

        <div>
          <label htmlFor="confirm-password" className="text-sm font-medium text-foreground">
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
            className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-indigo-300 focus:bg-card focus:outline-none"
          />
        </div>

        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        {success && !error && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">Password changed.</p>
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
    <section className="rounded-xl border-2 border-red-200 bg-red-50 p-6 dark:border-red-900/60 dark:bg-red-950/30">
      <h2 className="text-sm font-semibold text-red-900 dark:text-red-200">Danger Zone</h2>
      <p className="mt-1 text-sm text-red-700 dark:text-red-300/90">
        Permanently delete your account, every meeting you've captured, its
        transcripts and summaries, and its recorded audio. This cannot be
        undone.
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setShowModal(true)}
          className="rounded-lg border border-red-300 bg-card px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-100 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-900/40"
        >
          Delete my account
        </button>
      </div>

      {showModal && (
        <Modal title="Delete your account?" onClose={closeModal}>
          <p className="text-sm text-muted-foreground">
            This permanently deletes your account and every meeting you own -
            transcripts, summaries, action items, and recorded audio. There
            is no undo. Enter your password and confirm below to proceed.
          </p>

          <div className="mt-4">
            <label htmlFor="delete-password" className="text-sm font-medium text-foreground">
              Password
            </label>
            <input
              id="delete-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-border bg-muted px-3 py-2 text-sm text-foreground focus:border-red-300 focus:bg-card focus:outline-none"
            />
          </div>

          <label className="mt-4 flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={confirmChecked}
              onChange={(e) => setConfirmChecked(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-border text-red-600 focus:ring-red-500"
            />
            Yes, delete everything
          </label>

          {error && <p className="mt-3 text-sm text-red-600 dark:text-red-400">{error}</p>}

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={closeModal}
              disabled={deleting}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
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

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Laptop },
] as const;

function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  // next-themes doesn't know the resolved/stored theme until after mount
  // (it reads localStorage client-side) - rendering the toggle before then
  // would either guess wrong or mismatch what the no-flash script already
  // applied, so this shows a neutral skeleton for one tick instead.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <section className="rounded-xl border border-border bg-card p-6">
      <h2 className="text-sm font-semibold text-foreground">Appearance</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose how Meetscribe looks on this device.
      </p>

      <div className="mt-5">
        {!mounted ? (
          <div className="h-10 w-full max-w-xs animate-pulse rounded-lg bg-muted" />
        ) : (
          <div className="inline-flex rounded-lg border border-border bg-muted p-1">
            {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                type="button"
                onClick={() => setTheme(value)}
                className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  theme === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-6 py-10">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">
        Settings
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage your account and preferences.
      </p>

      <div className="mt-8 flex flex-col gap-6">
        <AccountSection />
        <ChangePasswordSection />
        <AppearanceSection />
        <DangerZoneSection />
      </div>
    </main>
  );
}
