"use client";

import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/use-hydrated";
import {
  GENESIS_TARGET,
  deriveAttempt,
  matchPositions,
  randomPrivateKey,
  type DrawAttempt,
} from "@/domain/bitcoin-keys";
import { ProofTicket } from "./ProofTicket";
import { ReelStrip } from "./ReelStrip";
import { GENESIS_TRIBUTES } from "./target";

export interface SlotCabinetProps {
  /**
   * The attempt for one pull. Defaults to a real draw: a fresh 256-bit key from the platform
   * CSPRNG, derived to a Bitcoin address. Injectable so a test can exercise the jackpot path
   * with an attempt whose address IS the target — nobody holds a key that gets there.
   */
  draw?: () => DrawAttempt;
}

export const NO_JS_SENTENCE =
  "Pulling needs JavaScript: the key is drawn and hashed in your browser and never leaves it.";

/** Reel travel plus the last reel's stagger; mirrors `--reel-delay` and the band transition
 *  in globals.css. Only the timing of the `landed` state depends on it. */
const SPIN_MS = 900;
const STAGGER_MS = 45;
const REELS = GENESIS_TARGET.address.length;

const realDraw = () => deriveAttempt(randomPrivateKey());

type Phase = "idle" | "spinning" | "landed";

/**
 * The machine: LED strip, three LCDs, the reel window, the key ticker and the plate with the
 * button. Every pull is a genuine attempt and the derivation is synchronous — a Jacobian
 * scalar multiplication over BigInt measures at a few milliseconds, well under a frame, so
 * there is no Worker and nothing to wait on. What the animation waits for is the reels.
 *
 * An enhancement, not a dependency (the `DecryptDemo` shape): the button renders only after
 * mount, and a reader without JavaScript gets a sentence saying why. Nothing is stored
 * anywhere — the pull count lives in React state and dies with the tab, which is what the
 * privacy sweep requires and what the page's own copy promises.
 */
export function SlotCabinet({ draw = realDraw }: SlotCabinetProps) {
  const mounted = useHydrated();
  const [attempt, setAttempt] = useState<DrawAttempt | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pulls, setPulls] = useState(0);
  const [drawnAt, setDrawnAt] = useState("");
  const [armed, setArmed] = useState(false);
  const [still, setStill] = useState(false);
  const timers = useRef<number[]>([]);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const id of held) window.clearTimeout(id);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    };
  }, []);

  function pull() {
    if (phase === "spinning") return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = draw();
    setAttempt(next);
    setDrawnAt(new Date().toISOString());
    setPulls((n) => n + 1);
    setStill(reduced);
    if (reduced) {
      // No motion: the reels are already showing the result, so the ticket prints at once.
      setArmed(true);
      setPhase("landed");
      return;
    }
    setArmed(false);
    setPhase("spinning");
    // The bands remount at their start position on this render; arming on the NEXT frame is
    // what lets the transition run rather than the element appearing already landed.
    frame.current = window.requestAnimationFrame(() => {
      frame.current = null;
      setArmed(true);
    });
    timers.current.push(
      window.setTimeout(() => setPhase("landed"), SPIN_MS + (REELS - 1) * STAGGER_MS + 150),
    );
  }

  const hits = attempt ? matchPositions(attempt.address, GENESIS_TARGET.address) : [];
  const spinning = phase === "spinning";
  const landed = phase === "landed";

  return (
    <div
      className={["slot-body", spinning && "is-spinning", armed && "is-spun", still && "is-still"]
        .filter(Boolean)
        .join(" ")}
      data-phase={phase}
    >
      <div className="slot-leds" aria-hidden="true">
        {Array.from({ length: 48 }, (_, i) => (
          <i key={i} />
        ))}
      </div>

      <div className="slot-displays">
        <div className="slot-lcd">
          <div className="slot-lcd-label">jackpot</div>
          <div
            className="slot-lcd-value tabular-nums"
            title={`${GENESIS_TRIBUTES.exactBtc} BTC, read ${GENESIS_TRIBUTES.readOn}`}
          >
            {GENESIS_TRIBUTES.btc}
            <small>BTC</small>
          </div>
        </div>
        <div className="slot-lcd">
          <div className="slot-lcd-label">odds per pull</div>
          <div className="slot-lcd-value tabular-nums">
            ≈ 1 : 2<sup>160</sup>
          </div>
        </div>
        <div className="slot-lcd">
          <div className="slot-lcd-label">pulls this visit</div>
          <div className="slot-lcd-value tabular-nums" data-pulls>
            {String(pulls).padStart(6, "0")}
          </div>
        </div>
      </div>

      <ReelStrip address={attempt?.address ?? null} hits={landed ? hits : null} spinKey={pulls} />

      <div className="slot-ticker" aria-hidden="true">
        <span className="slot-ticker-label">private key</span>
        <span className={attempt ? "slot-ticker-key is-live" : "slot-ticker-key"}>
          {attempt ? attempt.privateKeyHex : "—"}
        </span>
      </div>

      <div className="slot-plate">
        <div className="slot-plate-note">
          key drawn by <b>crypto.getRandomValues</b>
          <br />
          derived <b>secp256k1 → sha256 → ripemd160</b>
          <br />
          compared in your browser · <b>nothing sent</b>
        </div>
        <div className="flex justify-center">
          {mounted ? (
            <button
              type="button"
              className="slot-button"
              onClick={pull}
              disabled={spinning}
              data-pull
            >
              pull
            </button>
          ) : (
            <p className="text-center text-xs text-ink-dim">{NO_JS_SENTENCE}</p>
          )}
        </div>
        <div className="slot-plate-note slot-plate-note-right">
          34 of 34 · <b>the key</b>
          <br />
          33 or fewer · <b>nothing</b>
          <br />
          position 1 · <b>always</b> (the version byte)
        </div>
        <p className="slot-verdict" role="status">
          {phase === "idle" && mounted && "Pull the lever, or press the button."}
          {spinning && "drawing 256 bits…"}
          {landed && attempt && (
            <>
              <b className={attempt.jackpot ? "text-green" : "text-ink-bright"}>
                {attempt.jackpot ? "JACKPOT" : "NO MATCH"}
              </b>{" "}
              · {hits.filter(Boolean).length} of 34 reels on the payline · your ticket is below
            </>
          )}
        </p>
      </div>

      {mounted && (
        <div className="slot-lever" aria-hidden="true">
          <div className="slot-lever-mount" />
          <div className="slot-lever-arm" onClick={pull} />
        </div>
      )}

      <div className="slot-ticket-slot" aria-hidden="true" />
      {attempt && (
        <ProofTicket attempt={attempt} hits={hits} pull={pulls} drawnAt={drawnAt} out={landed} />
      )}
    </div>
  );
}
