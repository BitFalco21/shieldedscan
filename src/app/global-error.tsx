"use client";

/**
 * Replaces the root layout when the shell itself crashes, so it renders without
 * the token layer; this is the one file allowed literal colour classes. The
 * literals are the Phosphor palette by hand: bg #050805, ink #d9ffe4, green
 * #2bff64, edge rgba(43,255,100,.28).
 */
export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#050805] text-center font-mono text-[#d9ffe4]">
        <h1 className="text-2xl font-bold tracking-tight text-[#f2fff5]">
          <span className="text-[#2bff64]">./shieldedscan</span> failed to start
        </h1>
        <p className="max-w-md text-sm text-[#7fbf93]">
          The application shell hit an error. Reloading usually clears it.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-2 cursor-pointer rounded-md border border-[rgba(43,255,100,0.28)] px-5 py-2 text-sm hover:text-[#2bff64]"
        >
          Reload
        </button>
      </body>
    </html>
  );
}
