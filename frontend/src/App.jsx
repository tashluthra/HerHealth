import React from "react";
import SquatCam from "./components/SquatCam";
import ErrorBoundary from "./ErrorBoundary";

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <header className="border-b bg-white/70">
        <div className="mx-auto max-w-3xl p-4">
          <h1 className="text-xl font-semibold">HerHealth</h1>
        </div>
      </header>

      <ErrorBoundary>
        <main className="mx-auto max-w-3xl p-4">
          <SquatCam />
        </main>
      </ErrorBoundary>
    </div>
  );
}
