"use client";

import React, { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Next.js global layout error:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center bg-[#05150d] px-4 text-center text-white">
        <div className="mx-auto max-w-md rounded-3xl border border-amber-500/30 bg-[#0a2618] p-8 shadow-2xl">
          <span className="text-4xl">🎄</span>
          <h2 className="mt-4 font-serif text-2xl font-bold text-amber-200">
            The Magic of Secret Santa
          </h2>
          <p className="mt-2 text-sm text-emerald-200/80">
            A temporary connection issue occurred.
          </p>
          <button
            onClick={() => reset()}
            type="button"
            className="mt-6 rounded-full border border-amber-400 bg-red-700 px-6 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer"
          >
            Reload Website
          </button>
        </div>
      </body>
    </html>
  );
}
