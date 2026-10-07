export interface CheckMessageProps {
  tone: "ok" | "info" | "warn" | "err";
  title: string;
  children: string;
}

const TONE_CLASS: Readonly<Record<CheckMessageProps["tone"], string>> = {
  ok: "text-green",
  info: "text-ink-dim",
  warn: "text-warn",
  err: "text-red",
};

/** A check's verdict in words: a coloured title over one sentence of what to do. */
export function CheckMessage({ tone, title, children }: CheckMessageProps) {
  return (
    <div className="grid gap-1.5">
      <p className={`text-sm font-semibold ${TONE_CLASS[tone]}`}>{title}</p>
      <p className="max-w-[64ch] text-sm text-ink">{children}</p>
    </div>
  );
}
