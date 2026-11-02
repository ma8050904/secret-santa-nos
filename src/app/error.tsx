"use client";

import React, { useEffect } from "react";
import { RefreshCw } from "lucide-react";

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Next.js app route error:", error);
  }, [error]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[#05150d] px-4 text-center text-white">
      <div className="mx-auto max-w-md rounded-3xl border border-amber-500/30 bg-gradient-to-b from-[#0a2618] to-[#04120b] p-8 shadow-2xl backdrop-blur-xl">
        <span className="text-4xl">🎄</span>
        <h2 className="mt-4 font-serif text-2xl font-bold text-amber-200">
          The Magic of Secret Santa
        </h2>
        <p className="mt-2 text-sm text-emerald-200/80">
          A temporary issue occurred while loading this view.
        </p>
        <button
          onClick={() => reset()}
          type="button"
          className="mt-6 inline-flex items-center gap-2 rounded-full border border-amber-400 bg-gradient-to-r from-red-700 to-red-800 px-6 py-2.5 text-xs font-bold text-white shadow-lg transition-transform hover:scale-105 cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Try Again</span>
        </button>
      </div>
    </div>
  );
}
