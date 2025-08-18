import { useEffect, useState } from "react";

export default function App() {
  const [resp, setResp] = useState(null);
  const apiBase = import.meta.env.VITE_API_URL || "http://localhost:8000";

  useEffect(() => {
    fetch(`${apiBase}/ping`)
      .then(r => r.json())
      .then(setResp)
      .catch(() => setResp({ status: "error" }));
  }, [apiBase]);

  return (
    <div className="min-h-screen grid place-items-center p-8 bg-gray-50">
      <div className="w-full max-w-xl rounded-2xl shadow p-6 bg-white">
        <h1 className="text-2xl font-bold mb-2">HerHealth – Frontend Check</h1>
        <p className="text-sm text-gray-600 mb-4">
          Calling <code>{apiBase}/ping</code>
        </p>
        <pre className="text-sm bg-gray-100 p-3 rounded">
          {resp ? JSON.stringify(resp, null, 2) : "Loading..."}
        </pre>
      </div>
    </div>
  );
}
