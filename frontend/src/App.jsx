import { useEffect, useState } from "react";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="p-4 border-b bg-white">
        <div className="max-w-3xl mx-auto">
          <h1 className="text-xl font-semibold">HerHealth</h1>
          <p className="text-sm text-gray-500">Phase 0 – Frontend Check</p>
        </div>
      </header>

      <main className="p-4">
        <div className="max-w-3xl mx-auto">
          {/* your existing ping-check UI goes here */}
        </div>
      </main>
    </div>
  );
}

