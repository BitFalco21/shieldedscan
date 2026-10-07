"use client";

import { useEffect, useRef, useState } from "react";
import type { LearnTx } from "@/domain";
import { DONATION_ADDRESS } from "@/lib/donation";
import { shortHash } from "@/lib/format";
import { TXID_PATTERN, parseLearnResponse } from "@/lib/learn-lookup";
import type { LearnExampleShape } from "@/lib/learn-lookup";
import { AddressCheckResult } from "./AddressCheckResult";
import { AskZeno } from "./AskZeno";
import { FinishPanel } from "./FinishPanel";
import { StepRail } from "./StepRail";
import type { StepRailItem } from "./StepRail";
import { TxCheckResult } from "./TxCheckResult";
import { CheckMessage } from "./CheckMessage";
import {
  RECOVERY_PHRASE_WARNING,
  STEP_EXAMPLE,
  checkAddress,
  isTxStep,
  looksLikeRecoveryPhrase,
  ownTransparentAddresses,
  stepVerdict,
} from "./learn-checks";
import type { AddressCheck, RealStepId, StepVerdict, TxStepId } from "./learn-checks";
import { REAL_STEP_CONTENT } from "./learn-steps";
import { BTN, BTN_PRIMARY } from "./learn-ui";

export interface RealGuideProps {
  priceUsd: number | null;
  pageUrl: string;
}

type StepResult =
  | { kind: "checking"; text: string }
  | { kind: "address"; check: AddressCheck; example: boolean }
  | { kind: "tx"; tx: LearnTx; example: boolean; verdict: StepVerdict }
  | { kind: "message"; tone: "err" | "info" | "warn"; title: string; text: string };

const stepIndex = (id: RealStepId): number => REAL_STEP_CONTENT.findIndex((s) => s.id === id);
const RECEIVE = stepIndex("receive");
const SHIELD = stepIndex("shield");
const SEND = stepIndex("send");

/** A step's number as the page prints it: "03". */
const stepNumber = (index: number): string => String(index + 1).padStart(2, "0");

const message = (tone: "err" | "info" | "warn", title: string, text: string): StepResult => ({
  kind: "message",
  tone,
  title,
  text,
});

const PHRASE = message("warn", RECOVERY_PHRASE_WARNING.title, RECOVERY_PHRASE_WARNING.text);
const UNAVAILABLE = message(
  "info",
  "couldn’t check right now",
  "This site couldn’t reach its data just now. Try again in a minute.",
);

/**
 * The real half of `/learn`: the reader does each step in their own wallet, pastes what it gives
 * them, and sees what the blockchain shows everyone else. Step two branches on what actually
 * arrived, so a reader whose ZEC came in shielded is told step three is not needed rather than
 * sent to shield nothing.
 */
export function RealGuide({ priceUsd, pageUrl }: RealGuideProps) {
  const [index, setIndex] = useState(0);
  const [inputs, setInputs] = useState<Partial<Record<RealStepId, string>>>({});
  const [results, setResults] = useState<Partial<Record<RealStepId, StepResult>>>({});
  const [own, setOwn] = useState<AddressCheck | null>(null);
  const [done, setDone] = useState<ReadonlySet<RealStepId>>(() => new Set());
  const [shieldNotNeeded, setShieldNotNeeded] = useState(false);
  const [unshieldSkipped, setUnshieldSkipped] = useState(false);
  const requests = useRef<Partial<Record<RealStepId, number>>>({});
  const heading = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const step = REAL_STEP_CONTENT[index]!;
  const yours = ownTransparentAddresses(own);

  // Moving to a step puts focus on its heading, so a keyboard or screen-reader user lands on it.
  useEffect(() => {
    if (!moved.current) return;
    const el = heading.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    if (el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, [index]);

  const go = (i: number) => {
    moved.current = true;
    setIndex(Math.max(0, Math.min(REAL_STEP_CONTENT.length - 1, i)));
  };
  const skipsShield = shieldNotNeeded && !done.has("shield");
  const nextIndex = (i: number) => (i === RECEIVE && skipsShield ? SEND : i + 1);
  const prevIndex = (i: number) => (i === SEND && skipsShield ? RECEIVE : i - 1);

  const setResult = (id: RealStepId, result: StepResult) =>
    setResults((prev) => ({ ...prev, [id]: result }));
  const markDone = (id: RealStepId) => setDone((prev) => new Set(prev).add(id));
  const setInput = (id: RealStepId, value: string) =>
    setInputs((prev) => ({ ...prev, [id]: value }));

  function checkWallet(example: boolean) {
    const check = checkAddress(example ? DONATION_ADDRESS : (inputs.wallet ?? ""));
    if (check.kind === "phrase") setInput("wallet", "");
    setResult("wallet", { kind: "address", check, example });
    if (
      !example &&
      (check.kind === "transparent" || check.kind === "sapling" || check.kind === "unified")
    ) {
      setOwn(check);
      markDone("wallet");
    }
  }

  async function checkTx(id: TxStepId, example: boolean) {
    let asked: { txid: string } | { example: LearnExampleShape };
    if (example) {
      asked = { example: STEP_EXAMPLE[id] };
    } else {
      const raw = (inputs[id] ?? "").trim();
      if (!raw)
        return setResult(
          id,
          message("err", "✗ nothing to check", "Paste a transaction ID first, or show an example."),
        );
      if (looksLikeRecoveryPhrase(raw)) {
        setInput(id, "");
        return setResult(id, PHRASE);
      }
      const txid = raw.toLowerCase();
      if (!TXID_PATTERN.test(txid)) {
        return setResult(
          id,
          message(
            "err",
            "✗ not a transaction ID",
            "A transaction ID is 64 characters of 0–9 and a–f. Check you copied all of it.",
          ),
        );
      }
      asked = { txid };
    }

    const token = (requests.current[id] ?? 0) + 1;
    requests.current[id] = token;
    setResult(id, {
      kind: "checking",
      text: "txid" in asked ? `looking up ${shortHash(asked.txid, 8)}` : "finding a recent example",
    });

    let result: StepResult = UNAVAILABLE;
    try {
      const response = await fetch(`/api/learn?${new URLSearchParams(asked)}`, {
        cache: "no-store",
      });
      const parsed = parseLearnResponse(await response.json().catch(() => null), asked);
      if (parsed?.status === "missing") {
        result = example
          ? message(
              "info",
              "no example right now",
              "Couldn’t find a recent one. Try again in a minute.",
            )
          : message(
              "info",
              "not found yet",
              "If you just sent it, wait a few seconds for it to reach the network, then check again.",
            );
      } else if (parsed?.status === "found" && parsed.tx) {
        const verdict = stepVerdict(id, parsed.tx.shape);
        result = { kind: "tx", tx: parsed.tx, example, verdict };
        if (!example && verdict.ok) {
          markDone(id);
          if (id === "receive") setShieldNotNeeded(verdict.skipsShield);
          if (id === "unshield") setUnshieldSkipped(false);
        }
      }
    } catch {
      result = UNAVAILABLE;
    }
    // A slower, older check must not overwrite a newer one.
    if (requests.current[id] === token) setResult(id, result);
  }

  const rail: StepRailItem[] = REAL_STEP_CONTENT.map((s) => ({
    label: s.label,
    done: done.has(s.id),
    tag:
      s.id === "shield" && skipsShield
        ? "not needed"
        : s.id === "unshield" && !done.has("unshield")
          ? unshieldSkipped
            ? "skipped"
            : "optional"
          : undefined,
  }));

  const result = results[step.id];

  return (
    <section
      aria-labelledby="learn-real-title"
      className="grid gap-5 md:grid-cols-[13rem_minmax(0,1fr)] md:items-start"
    >
      <h2 id="learn-real-title" className="sr-only">
        Do it for real
      </h2>
      <StepRail items={rail} current={index} onSelect={go} />

      <div className="panel min-w-0 p-5 md:p-7">
        <header className="grid gap-1">
          <p className="microlabel">
            step {stepNumber(index)} of {stepNumber(REAL_STEP_CONTENT.length - 1)} · {step.label}
          </p>
          <h3
            ref={heading}
            tabIndex={-1}
            className="text-xl font-semibold text-ink-bright focus:outline-none"
          >
            {step.title}
          </h3>
        </header>

        {step.id === "shield" && skipsShield ? (
          <p className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded border border-edge bg-green-wash px-3 py-2 text-sm text-ink-bright">
            Not needed: your ZEC arrived shielded.
            <button type="button" className={BTN_PRIMARY} onClick={() => go(SEND)}>
              {`skip to step ${stepNumber(SEND)} →`}
            </button>
          </p>
        ) : null}

        {step.todo.length ? (
          <ol className="mt-4 grid max-w-[64ch] gap-2 text-sm text-ink">
            {step.todo.map((line, i) => (
              <li key={i} className="grid grid-cols-[1.25rem_minmax(0,1fr)]">
                <span aria-hidden className="text-green">
                  ›
                </span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        ) : null}

        <div className="mt-3">
          <AskZeno question={step.question} />
        </div>

        {step.ask ? (
          <form
            className="mt-6 grid gap-2"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              if (step.id === "wallet") checkWallet(false);
              else if (isTxStep(step.id)) void checkTx(step.id, false);
            }}
          >
            <label htmlFor={`learn-in-${step.id}`} className="microlabel">
              {step.ask}
            </label>
            <div className="prompt-focus flex min-w-0 items-center gap-2.5 rounded border border-edge bg-bg px-3 py-2.5">
              <span aria-hidden className="text-green-dim">
                zcash&gt;
              </span>
              <input
                id={`learn-in-${step.id}`}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={step.placeholder}
                value={inputs[step.id] ?? ""}
                onChange={(event) => setInput(step.id, event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-sm text-ink-bright placeholder:text-ink-faint"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={BTN_PRIMARY}>
                check
              </button>
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  if (step.id === "wallet") checkWallet(true);
                  else if (isTxStep(step.id)) void checkTx(step.id, true);
                }}
              >
                show an example
              </button>
            </div>
            {step.note ? <p className="max-w-[64ch] text-xs text-ink-faint">{step.note}</p> : null}
          </form>
        ) : null}

        <div aria-live="polite">
          {result ? (
            <div className="mt-6 border-t border-edge-faint pt-5">
              {result.kind === "checking" ? (
                <p className="text-sm text-ink-dim">{result.text}…</p>
              ) : result.kind === "message" ? (
                <CheckMessage tone={result.tone} title={result.title}>
                  {result.text}
                </CheckMessage>
              ) : result.kind === "address" ? (
                <AddressCheckResult check={result.check} example={result.example} />
              ) : (
                <div className="grid gap-4">
                  {!result.verdict.ok ? (
                    <p className="rounded border border-warn-edge px-3 py-2 text-sm text-ink">
                      <b className="font-semibold text-warn">Not what this step expects.</b>{" "}
                      {result.verdict.message}
                    </p>
                  ) : step.id === "receive" && result.verdict.skipsShield && !result.example ? (
                    <p className="rounded border border-edge bg-green-wash px-3 py-2 text-sm text-ink-bright">
                      {`It arrived shielded, so step ${stepNumber(SHIELD)} is not needed.`}
                    </p>
                  ) : null}
                  <TxCheckResult
                    tx={result.tx}
                    example={result.example}
                    yours={yours}
                    priceUsd={priceUsd}
                  />
                </div>
              )}
            </div>
          ) : null}
        </div>

        {step.id === "done" ? (
          <div className="mt-6">
            <FinishPanel pageUrl={pageUrl} />
          </div>
        ) : null}

        <footer className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-edge-faint pt-4">
          {index > 0 ? (
            <button type="button" className={BTN} onClick={() => go(prevIndex(index))}>
              ← back
            </button>
          ) : (
            <span />
          )}
          <div className="flex flex-wrap gap-2">
            {step.id === "unshield" ? (
              <button
                type="button"
                className={BTN}
                onClick={() => {
                  setUnshieldSkipped(true);
                  go(index + 1);
                }}
              >
                skip →
              </button>
            ) : null}
            {step.id === "done" ? null : (
              <button type="button" className={BTN_PRIMARY} onClick={() => go(nextIndex(index))}>
                {step.id === "receive"
                  ? skipsShield
                    ? "next: send privately"
                    : "next: shield it"
                  : step.next}{" "}
                →
              </button>
            )}
          </div>
        </footer>
      </div>
    </section>
  );
}
