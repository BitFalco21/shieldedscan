import Link from "@/components/Link";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <div className="microlabel">NOT ON CHAIN</div>
      <h1 className="text-3xl font-bold tracking-[0.1em] text-ink-bright">
        NOTHING HERE IS <b className="text-green">HIDDEN</b>
        {" — "}IT JUST DOESN&apos;T EXIST
      </h1>
      <p className="max-w-md text-sm text-ink-dim">
        No block, transaction, or address matches this page. Shielded data would tell you it&apos;s
        shielded — this is simply a dead end.
      </p>
      <Link href="/" className="panel mt-2 px-5 py-2 text-sm hover:text-green">
        ← back to overview
      </Link>
    </div>
  );
}
