import { useEffect, useState } from "react";

const API = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function UsersDemo() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function load() {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API}/users`);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      setUsers(await res.json());
    } catch (e) {
      setError(e.message || "Failed to load users");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function onSubmit(e) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`${API}/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Error ${res.status}`);
      setName("");
      setEmail("");
      await load();
    } catch (e) {
      setError(e.message || "Failed to create user");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border bg-white/70 p-4 shadow-sm">
      <h3 className="mb-2 font-semibold">Users</h3>

      <form onSubmit={onSubmit} className="grid gap-2">
        <input
          className="rounded border p-2"
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
        />
        <input
          className="rounded border p-2"
          placeholder="Email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <button
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-60"
          disabled={saving}
        >
          {saving ? "Saving…" : "Add user"}
        </button>
      </form>

      {error && (
        <div className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">
          Error: {error}
        </div>
      )}

      <div className="mt-4">
        <h4 className="font-medium">All users</h4>
        {loading ? (
          <div className="text-sm text-gray-500">Loading…</div>
        ) : users.length === 0 ? (
          <div className="text-sm text-gray-500">No users yet.</div>
        ) : (
          <ul className="mt-1 list-disc pl-5">
            {users.map((u) => (
              <li key={u.id}>
                <strong>{u.name}</strong> — {u.email}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
