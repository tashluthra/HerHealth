import React, { useEffect, useState } from "react";
import UsersDemo from "./UsersDemo";
import SquatCam from "./components/SquatCam";


const API = import.meta.env.VITE_API_URL || "https://herhealth-api.onrender.com";

function Box({ title, data, error }) {
  return (
    <div className="rounded-lg border bg-white/70 p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-semibold">{title}</h3>
        {error ? (
          <span className="text-xs rounded bg-red-100 px-2 py-0.5 text-red-700">
            error
          </span>
        ) : (
          <span className="text-xs rounded bg-green-100 px-2 py-0.5 text-green-700">
            ok
          </span>
        )}
      </div>
      <pre className="overflow-auto rounded bg-gray-50 p-2 text-sm">
        {error ? error : JSON.stringify(data, null, 2)}
      </pre>
    </div>
  );
}

export default function App() {
  const [results, setResults] = useState({
    ping: { data: null, error: null },
    healthz: { data: null, error: null },
    version: { data: null, error: null },
  });

  useEffect(() => {
    const endpoints = ["ping", "healthz", "version"];
    Promise.allSettled(
      endpoints.map((e) =>
        fetch(`${API}/${e}`).then((r) => {
          if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
          return r.json();
        })
      )
    ).then((settled) => {
      const next = { ...results };
      settled.forEach((res, i) => {
        const key = endpoints[i];
        if (res.status === "fulfilled") {
          next[key] = { data: res.value, error: null };
        } else {
          next[key] = { data: null, error: res.reason?.message || "fetch failed" };
        }
      });
      setResults(next);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white/70">
        <div className="mx-auto max-w-3xl p-4">
          <h1 className="text-xl font-semibold">HerHealth</h1>
          <p className="text-sm text-gray-500">Phase 0 • Frontend Check</p>
          <p className="text-xs text-gray-500">
            Calling <code className="font-mono">{API}</code>
          </p>
        </div>
      </header>

        <main className="mx-auto max-w-3xl p-4 space-y-4">
        {/* Week 3 camera component */}
        <SquatCam />

        <Box title="/ping" data={results.ping.data} error={results.ping.error} />
        <Box title="/healthz" data={results.healthz.data} error={results.healthz.error} />
        <Box title="/version" data={results.version.data} error={results.version.error} />
        <UsersDemo />
      </main>

    </div>
  );
}


