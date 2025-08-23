import { useEffect, useState } from "react";

export default function App() {
  const [resp, setResp] = useState(null);
  const api = (import.meta.env.VITE_API_URL || "http://localhost:8000") + "/ping";

  useEffect(() => {
    fetch(api).then(r => r.json()).then(setResp).catch(() => setResp({ status: "error" }));
  }, [api]);

  return (
    <div style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>HerHealth – Frontend Check</h1>
      <p>Calling: <code>{api}</code></p>
      <pre>{resp ? JSON.stringify(resp, null, 2) : "Loading..."}</pre>
    </div>
  );
}
