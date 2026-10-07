"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  PulseBlock,
  PulseEvent,
  PulseFrame,
  PulseLedgerRow,
  PulseRibbonsPayload,
} from "@/domain";
import { PULSE_RIBBON_WINDOW_NAMES, type PulseRibbonWindowName } from "@/domain";
import { Badge } from "@/components/Badge";
import { LiveAnnouncer } from "@/components/LiveAnnouncer";
import { pulseNodeClass } from "@/lib/pulse-palette";
import { formatCount, formatZecAmount, timeAgo } from "@/lib/format";
import { useDisplayNow } from "@/lib/use-display-now";
import { useHydrated } from "@/lib/use-hydrated";
import { usePrefersReducedMotion } from "@/lib/use-reduced-motion";
import { Heartbeat } from "./Heartbeat";
import { PulseDiagram } from "./PulseDiagram";
import { PulseLog, PULSE_LOG_ROWS, type PulseLogEntry } from "./PulseLog";
import { PulseSegmented } from "./PulseSegmented";
import {
  PULSE_RANGES,
  PULSE_SPEEDS,
  PulseTransport,
  type PulseMode,
  type PulseRange,
  type PulseSpeed,
} from "./PulseTransport";
import { PulseMotionEngine } from "./motion-engine";
import { pulseLayout } from "./pulse-layout";
import {
  anyIndexedLate,
  blocksDue,
  collapseBlockEvents,
  poolsAtSim,
  pulsePlacementSeconds,
  shouldCollapse,
  swapsDue,
} from "./pulse-scheduler";
import { coverageNote, isCrossing } from "./pulse-text";
import { usePulseLive } from "@/lib/use-pulse-live";
import { pulseHourOf, usePulseReplay } from "@/lib/use-pulse-replay";

export interface PulseStageProps {
  /** The server's frame 0. */
  frame: PulseFrame;
  /** Null when the day views behind the ribbon totals have not been filled. */
  ribbons: PulseRibbonsPayload | null;
  /** The server's clock, so relative ages match the HTML before JavaScript takes over. */
  serverNow: number;
  /** Rendered beside the log. A server node, so its controls never reach the static markup. */
  ledgerPanel?: ReactNode;
}

const WINDOW_LABEL: Readonly<Record<PulseRibbonWindowName, string>> = {
  all: "all time",
  "1y": "the last year",
  "30d": "the last 30 days",
};

/** The most age handed to the heartbeat's growing live bar. */
const LIVE_BAR_MAX_SECONDS = 600;

/** How often the replay clock is mirrored into React state. A frame-by-frame mirror is waste. */
const CLOCK_MIRROR_MS = 250;

/**
 * The most ledger rows a replay hands the box, matching what the server sends live. A bound, not
 * the display grain: `LedgerRows` fits what the box's geometry allows.
 */
const REPLAY_LEDGER_ROWS = 40;

interface LoopState {
  mode: PulseMode;
  playing: boolean;
  speed: PulseSpeed;
  blocks: readonly PulseBlock[];
  swaps: readonly PulseEvent[];
  anchor: number;
}

/**
 * The whole live surface: the stage, the clock above it, the transport under it and the log.
 *
 * The server's frame 0 is the page, and everything here is an enhancement. Without JavaScript a
 * reader gets the boxes at their measured sizes, the ribbons, the real ledger rows and the
 * newest block's movements written out — a true picture of the tip, with no controls that could
 * not work and no marks claiming to have just arrived.
 *
 * Three rules are enforced here:
 *
 *  - The first accepted poll plays nothing. It reconciles against a prerendered, CDN-cached
 *    page, so "absent from that HTML" is not "arrived while you were watching".
 *  - A reorg clears everything and stops. The rows above a reorged tip can include the orphaned
 *    block, and a balance read at a height that no longer exists is a wrong number.
 *  - The status line speaks only for `unavailable` and `reorganised`. Arriving marks are
 *    themselves the signal that the feed is alive.
 */
export function PulseStage({ frame, ribbons, serverNow, ledgerPanel }: PulseStageProps) {
  // Controls exist only where they can work. Server render: false, so the static markup has no
  // button and no input at all.
  const mounted = useHydrated();
  const still = usePrefersReducedMotion();
  const [mode, setMode] = useState<PulseMode>("live");
  const [range, setRange] = useState<PulseRange>(PULSE_RANGES[0]);
  const [speed, setSpeed] = useState<PulseSpeed>(PULSE_SPEEDS[1]);
  const [playing, setPlaying] = useState(true);
  const [secondsAgo, setSecondsAgo] = useState<number>(PULSE_RANGES[0]);
  const [windowName, setWindowName] = useState<PulseRibbonWindowName>("all");
  const [announced, setAnnounced] = useState({ blocks: 0, movements: 0 });

  const stageRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pulseLayerRef = useRef<SVGGElement | null>(null);
  const pendingLayerRef = useRef<SVGGElement | null>(null);
  const engineRef = useRef<PulseMotionEngine | null>(null);
  /** Blocks whose movements have been drawn, by hash. Seeded with the server's own frame. */
  const played = useRef<Set<string>>(new Set(frame.blocks.map((b) => b.pools.hash)));
  /**
   * Crossings already drawn, by id — seeded with the server's frame for the same reason the
   * blocks are: frame 0 rendered them, so nothing arrived while anybody was watching.
   */
  const playedSwaps = useRef<Set<string>>(new Set(frame.swaps.map((s) => s.id)));
  const simRef = useRef<number>(0);
  const loopRef = useRef<LoopState | null>(null);

  /**
   * On a narrow screen the stage scrolls sideways and starts at the right, where the pools,
   * lockbox and ledger box are; left-anchored, a phone would show only the chain column and
   * empty space.
   *
   * Anchored once there is something to anchor: at effect time the SVG has not been laid out
   * against its narrow-screen min-width, so `scrollWidth` still equals `clientWidth`. An
   * observer fires when the box gets its width and disconnects once it has anchored. Set in
   * script, not an inline style, so the server's HTML is unchanged; a wide screen has nothing to
   * scroll.
   */
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null) return;
    const anchorScroll = (): boolean => {
      const overflow = stage.scrollWidth - stage.clientWidth;
      if (overflow <= 0) return false;
      stage.scrollLeft = overflow;
      return true;
    };
    if (anchorScroll()) return;
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(() => {
      if (anchorScroll()) observer.disconnect();
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const live = usePulseLive({ initial: frame, enabled: mode === "live" });
  const liveFrame = live.frame;
  // Chain time rather than the wall clock: the replay window endpoints are chain instants, and
  // anchoring on a reader's clock would ask for an hour our index cannot have.
  const anchor = liveFrame.stocks.receivedAt ?? liveFrame.stocks.timestamp;
  const simSeconds = anchor - secondsAgo;
  const replay = usePulseReplay({
    enabled: mode === "replay",
    simSeconds,
    nowSeconds: anchor,
  });

  const displayNow = useDisplayNow(serverNow);
  const reorganised = live.status === "reorganised";

  // The closes at the newest block at or before the clock — never a balance from one row
  // beside a height from another, and never the tip's balances under a replay chip.
  const replayStocks = mode === "replay" ? poolsAtSim(replay.blocks, simSeconds) : null;
  const measured = mode !== "replay" || replayStocks !== null;
  const stocks = useMemo(() => {
    if (mode !== "replay") return liveFrame.stocks;
    if (replayStocks !== null) return replayStocks;
    // Nothing we hold covers this instant, so every balance is absent — outlined and labelled —
    // rather than the tip's, which would be a figure at a height it was not measured at.
    return {
      ...liveFrame.stocks,
      pools: {
        transparent: null,
        lockbox: null,
        sprout: null,
        sapling: null,
        orchard: null,
        ironwood: null,
      },
    };
  }, [mode, liveFrame.stocks, replayStocks]);

  const shownBlocks = useMemo(
    () =>
      mode === "replay"
        ? replay.blocks.filter((b) => pulsePlacementSeconds(b) <= simSeconds)
        : liveFrame.blocks,
    [mode, replay.blocks, simSeconds, liveFrame.blocks],
  );

  const events = useMemo(
    () => [...shownBlocks.flatMap((b) => b.events), ...liveFrame.swaps],
    [shownBlocks, liveFrame.swaps],
  );

  /**
   * The ledger rows a replay may show: the hour's own outputs at or below the block the clock
   * has reached, newest first.
   *
   * Bounded by the height the boxes are reading, not the clock in seconds, so a row and the
   * balances beside it come from the same block, and rows appear as the replay reaches their
   * block.
   *
   * Three states:
   *  - `null` — no loaded hour carried a `ledger` key. An API predating the field said nothing,
   *    which is not the claim that the hour had no outputs.
   *  - `undefined` — the clock has not resolved to a block we hold, so nothing is measured; "no
   *    transparent outputs yet" would misreport our unread hour.
   *  - an array — the rows at or below the reached block, possibly empty, which is a
   *    measurement.
   */
  const replayLedger = useMemo(() => {
    if (mode !== "replay" || !replay.ledgerCarried) return null;
    const height = replayStocks?.height;
    if (height === undefined) return undefined;
    return replay.ledger.filter((row) => row.height <= height).slice(0, REPLAY_LEDGER_ROWS);
  }, [mode, replay.ledgerCarried, replay.ledger, replayStocks]);

  /**
   * The loaded hour the clock is inside — the one every "this hour" sentence is about.
   *
   * The flattened rows legitimately span an hour boundary; a cap does not. It is a claim about
   * the hour it was applied to, and the hook keeps two hours ahead loaded and prunes none, so an
   * OR over the session would state "this hour holds more" over an hour that handed over
   * everything.
   */
  const replayHour = useMemo(
    () =>
      mode === "replay"
        ? replay.hours.find((h) => h.from === pulseHourOf(Math.floor(simSeconds)))
        : undefined,
    [mode, replay.hours, simSeconds],
  );

  const layout = useMemo(
    () =>
      pulseLayout({
        stocks,
        ribbons: ribbons === null ? null : ribbons.windows[windowName],
        events,
        windowLabel: WINDOW_LABEL[windowName],
        measured,
      }),
    [stocks, ribbons, windowName, events, measured],
  );
  // Declared after the layout so the seed rows take the same frame-derived chain colours the
  // stage does: a log dot and the mark it names must not be able to disagree.
  const [log, setLog] = useState<PulseLogEntry[]>(() => seedLog(frame, layout.chainClasses));
  const chainClasses = layout.chainClasses;
  /**
   * The frame's chain colours, read through a ref by the two play callbacks. They cannot close
   * over the value: the animation-loop effect is built once and keyed on those callbacks, and a
   * callback whose identity changed per block would dispose the engine and drop every mark in
   * flight. The ref is written in an effect, which runs before the loop's next frame.
   */
  const chainClassesRef = useRef(chainClasses);
  useEffect(() => {
    chainClassesRef.current = chainClasses;
  }, [chainClasses]);

  // The engine reads the newest layout without being rebuilt: the boxes resize once per block
  // and a rebuild would take every mark in flight with them.
  useEffect(() => {
    engineRef.current?.setLayout(layout);
  }, [layout]);
  useEffect(() => {
    engineRef.current?.setStill(still);
  }, [still]);
  useEffect(() => {
    engineRef.current?.setSpeed(mode === "replay" ? speed : 1);
  }, [mode, speed]);

  const pushLog = useCallback((entries: readonly PulseLogEntry[]) => {
    if (entries.length === 0) return;
    setLog((prev) => [...entries, ...prev].slice(0, PULSE_LOG_ROWS));
  }, []);

  /**
   * Draw one block's movements, or its per-edge sums when it is too busy to draw them.
   * `coverage` rides on every mark and on the log, so a capped block never presents its slice as
   * its total.
   */
  const playBlock = useCallback(
    (block: PulseBlock, speedNow: number, nowMs: number): number => {
      const engine = engineRef.current;
      if (engine === null) return 0;
      const at = pulsePlacementSeconds(block);
      const coverage = { drawn: block.events.length, total: block.eventCount };
      const shortfall = coverageNote(coverage);
      const height = formatCount(block.pools.height);
      const notes: PulseLogEntry[] = [];
      const note = (text: string) =>
        notes.push(
          noteEntry(`${block.pools.hash}:${notes.length}:${text}`, block.pools.hash, text, at),
        );

      if (shouldCollapse(speedNow, block.eventCount)) {
        const collapsed = collapseBlockEvents(block);
        engine.spawnCollapsed(collapsed, nowMs, coverage);
        for (const edge of collapsed.edges) {
          note(
            `${edge.count} tx · Σ ${formatZecAmount(edge.totalZat)} ZEC · ${edge.from} → ${edge.to} · block ${height}`,
          );
        }
        // Counted, never dropped: a shielded movement has no amount to sum and a hub has no
        // direction to file one under, and leaving both out draws a busy block as a small one.
        for (const veil of collapsed.veils) {
          note(`${veil.count} inside ${veil.pool} · amounts private by design · block ${height}`);
        }
        if (collapsed.hubs > 0) {
          note(
            `${collapsed.hubs} unsettled · direction not settled by the chain · block ${height}`,
          );
        }
        if (shortfall !== null) note(`${shortfall} · block ${height}`);
        pushLog(notes);
        return collapsed.edges.length + collapsed.veils.length + (collapsed.hubs > 0 ? 1 : 0);
      }

      for (const event of block.events) {
        // A movement our node already showed as pending becomes this mark rather than a
        // second one beside it.
        engine.convertPending(event.id);
        engine.spawnEvent(event, nowMs, coverage);
      }
      if (shortfall !== null) note(`${shortfall} · block ${height}`);
      pushLog([
        ...notes,
        ...block.events.map((event) =>
          movementEntry(`${block.pools.hash}:${event.id}`, event, at, chainClassesRef.current),
        ),
      ]);
      return block.events.length;
    },
    [pushLog],
  );

  /**
   * A crossing no Zcash block recorded, placed at venue time. A venue saying a crossing
   * completed is not the chain saying which block carried it, so it lights nothing and stops at
   * the boundary.
   */
  const playSwap = useCallback(
    (event: PulseEvent, nowMs: number): void => {
      const engine = engineRef.current;
      if (engine === null) return;
      engine.spawnEvent(event, nowMs);
      pushLog([movementEntry(`swap:${event.id}`, event, event.at, chainClassesRef.current)]);
    },
    [pushLog],
  );

  // One animation loop for the page: it advances the replay clock, fires whatever that clock
  // has reached, and lets the engine move everything in flight.
  useEffect(() => {
    const svg = svgRef.current;
    const pulses = pulseLayerRef.current;
    const pending = pendingLayerRef.current;
    if (svg === null || pulses === null || pending === null) return;
    const engine = new PulseMotionEngine({
      root: pulses,
      pendingRoot: pending,
      stage: svg,
      layout,
      still,
    });
    engineRef.current = engine;

    let raf = 0;
    let lastFrame = 0;
    let lastMirror = 0;
    const loop = (nowMs: number) => {
      const state = loopRef.current;
      if (state !== null && state.mode === "replay") {
        const dt = lastFrame === 0 ? 0 : Math.min(0.25, (nowMs - lastFrame) / 1000);
        if (state.playing) simRef.current += dt * state.speed;
        // Catching up with the present hands the page back to the live feed rather than
        // replaying an hour that has not happened.
        if (simRef.current >= state.anchor) {
          simRef.current = state.anchor;
          setMode("live");
        }
        let drawn = 0;
        for (const block of blocksDue(state.blocks, simRef.current, played.current)) {
          played.current.add(block.pools.hash);
          drawn += playBlock(block, state.speed, nowMs);
        }
        // Crossings are placed at venue time, so they are due on their own clock rather than
        // on any block's.
        for (const swap of swapsDue(state.swaps, simRef.current, playedSwaps.current)) {
          playedSwaps.current.add(swap.id);
          playSwap(swap, nowMs);
          drawn += 1;
        }
        if (drawn > 0) setAnnounced((prev) => ({ ...prev, movements: prev.movements + drawn }));
        if (nowMs - lastMirror > CLOCK_MIRROR_MS) {
          lastMirror = nowMs;
          setSecondsAgo(Math.max(0, Math.round(state.anchor - simRef.current)));
        }
      }
      lastFrame = nowMs;
      engine.frame(nowMs);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
      engineRef.current = null;
    };
    // Built once: the engine is handed later layouts, stillness and speeds through its own
    // setters, because rebuilding it would drop every mark in flight on every new block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playBlock, playSwap]);

  // Written in an effect rather than during render: the loop reads it on the next frame, so
  // there is nothing to gain from setting it earlier and a ref written during render is a
  // render with a side effect.
  useEffect(() => {
    loopRef.current = {
      mode,
      playing,
      speed,
      blocks: replay.blocks,
      swaps: replay.swaps,
      anchor,
    };
  }, [mode, playing, speed, replay.blocks, replay.swaps, anchor]);

  // Live arrivals. Nothing is drawn for the first accepted poll — see the header.
  useEffect(() => {
    if (mode !== "live" || live.polls === 0) return;
    const engine = engineRef.current;
    const fresh = liveFrame.blocks.filter((b) => !played.current.has(b.pools.hash));
    for (const block of fresh) played.current.add(block.pools.hash);
    if (engine === null) return;
    let drawn = 0;
    if (live.polls > 1) {
      for (const block of fresh) drawn += playBlock(block, 1, performance.now());
    }
    // Crossings the frame carries that no block in it recorded. Placed at venue time and
    // lighting nothing, but still drawn: they are movements.
    const freshSwaps = liveFrame.swaps.filter((s) => !playedSwaps.current.has(s.id));
    for (const swap of freshSwaps) playedSwaps.current.add(swap.id);
    if (live.polls > 1) {
      for (const swap of freshSwaps) {
        playSwap(swap, performance.now());
        drawn += 1;
      }
    }
    if (fresh.length > 0 || drawn > 0) {
      setAnnounced((prev) => ({
        blocks: prev.blocks + fresh.length,
        movements: prev.movements + drawn,
      }));
    }
  }, [mode, live.polls, liveFrame, playBlock, playSwap]);

  // The mempool layer. Exactly two exits: converted by txid when a block confirms it, or faded
  // when our node stops offering it.
  useEffect(() => {
    const engine = engineRef.current;
    if (engine === null || mode !== "live") return;
    const offered = live.pending?.events ?? [];
    const ids = new Set(offered.map((e) => e.id));
    const nowMs = performance.now();
    for (const id of engine.pendingIds()) {
      if (!ids.has(id)) engine.expirePending(id, nowMs);
    }
    for (const event of offered) engine.addPending(event);
  }, [mode, live.pending]);

  // A reorg invalidates everything drawn against the tip it contradicted, including the
  // balances: nothing accumulated survives, and the poll has already halted.
  useEffect(() => {
    if (!reorganised) return;
    // Only the DOM is cleared here. The log and the announcement are not re-rendered at all —
    // the component returns the notice instead — so no state is left describing a chain that
    // changed underneath it.
    engineRef.current?.clearAll();
  }, [reorganised]);

  /**
   * Restart the replay `secondsAgo` behind the anchor, with nothing drawn: entering replay, a new
   * range, and a scrub all start from a clean stage. The clock is set here from the anchor this
   * render holds, not via a sentinel for an effect, which would not fire when a scrub lands on the
   * value already in state.
   */
  const replayFrom = useCallback(
    (secondsAgo: number) => {
      engineRef.current?.clearAll();
      played.current = new Set();
      playedSwaps.current = new Set();
      setLog([]);
      simRef.current = anchor - secondsAgo;
      setSecondsAgo(secondsAgo);
    },
    [anchor],
  );

  const onMode = useCallback(
    (next: PulseMode) => {
      setMode(next);
      if (next === "replay") replayFrom(range);
      else {
        engineRef.current?.clearAll();
        played.current = new Set(liveFrame.blocks.map((b) => b.pools.hash));
        playedSwaps.current = new Set(liveFrame.swaps.map((s) => s.id));
        setLog(seedLog(liveFrame, chainClasses));
      }
    },
    [replayFrom, range, liveFrame, chainClasses],
  );

  const onRange = useCallback(
    (next: PulseRange) => {
      setRange(next);
      replayFrom(next);
    },
    [replayFrom],
  );

  const ageSeconds = Math.max(0, displayNow - anchor);
  // Before the first poll there is nothing to say about the mempool: the server deliberately
  // does not read it, and "unavailable" would report a question nobody has asked yet as our
  // outage. `null` after a poll IS our outage, which is a different claim and is said.
  const pendingCount = live.polls === 0 ? undefined : (live.pending?.count ?? null);
  const pendingDrawn = live.pending?.events.length ?? 0;

  if (reorganised) {
    return (
      <div className="space-y-3.5">
        <p role="status" className="pulse-status">
          reorganised — reload
        </p>
        <p className="text-sm text-ink-faint">
          A height we had already drawn now reports a different hash, so everything measured against
          it — the balances, the movements and the intervals — has been discarded.
        </p>
      </div>
    );
  }

  return (
    <div className={["space-y-3.5", still ? "is-still" : ""].filter(Boolean).join(" ")}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="text-sm text-ink-dim tabular-nums">
          <p className="text-xl font-light text-ink-bright">
            {measured ? `block ${formatCount(stocks.height)}` : "no block read here"}
          </p>
          {mode === "replay" ? (
            <p>
              <Badge tone="outline" className="align-middle">
                replay ×{speed}
              </Badge>{" "}
              {new Date(simSeconds * 1000).toISOString().slice(11, 19)} UTC
              {measured
                ? ` · ${Math.max(0, Math.round(simSeconds - (stocks.receivedAt ?? stocks.timestamp)))}s since it landed`
                : " · this hour has not been read"}
            </p>
          ) : (
            <p>
              our node received it <span className="text-ink">{timeAgo(anchor, displayNow)}</span>
              {pendingCount === undefined
                ? null
                : pendingCount === null
                  ? " · mempool unavailable"
                  : ` · mempool ${pendingCount} pending${
                      pendingDrawn < pendingCount ? ` · ${pendingDrawn} drawn` : ""
                    }`}
            </p>
          )}
        </div>
        <Heartbeat
          blocks={shownBlocks}
          liveSeconds={
            live.status === "unavailable" || mode === "replay"
              ? null
              : Math.min(LIVE_BAR_MAX_SECONDS, ageSeconds)
          }
          unavailable={live.status === "unavailable"}
        />
      </div>

      <section className="panel overflow-hidden p-0">
        <div className="pulse-stage" ref={stageRef}>
          <PulseDiagram
            layout={layout}
            ledger={mode === "replay" ? (replayLedger ?? []) : liveFrame.ledger}
            ledgerNote={mode === "replay" ? replayLedgerNote(replayLedger) : undefined}
            svgRef={svgRef}
            pulseLayerRef={pulseLayerRef}
            pendingLayerRef={pendingLayerRef}
          />
        </div>
        <div className="pulse-rulers">
          {/* Only where there is something to scroll — and the width that IS is a CSS
              decision, so the hint hides from the same media query that creates the scroll
              rather than from a Tailwind breakpoint that can drift away from it. */}
          <p className="pulse-scroll-hint microlabel text-ink-faint">
            ← scroll for the ledger and the chains
          </p>
          {/* The rulers are stated in the diagram's own <desc>, not printed here. What stays
              visible is the one state a reader must not miss. */}
          {layout.ribbonsAvailable ? null : (
            <p className="microlabel is-unavailable text-ink-faint">
              ribbons unavailable · drawn at minimum width
            </p>
          )}
          {/* This hour holds more outputs than it carried. Read off the hour the clock is
              inside, never the session: the hook keeps two hours ahead loaded, so a
              session-wide flag would state a cap over an hour that handed over everything.
              Exact — the read asks for one row more than it returns. */}
          {mode === "replay" && replayHour?.ledgerTruncated === true ? (
            <p className="microlabel is-unavailable text-ink-faint">
              {replayHour.ledgerRows} outputs carried · this hour holds more
            </p>
          ) : null}
          {/* Only when the frame said it cut: the crossings on screen are then a window onto
              the span, and drawing N of them silently would state them as all of them. Live
              only; a replay hour publishes the same fact on the hour. No leading glyph, to
              avoid a character JetBrains Mono may lack. */}
          {mode !== "replay" && liveFrame.swapsTruncated ? (
            <p className="microlabel is-unavailable text-ink-faint">
              {liveFrame.swaps.length} crossings drawn · this span holds more
            </p>
          ) : null}
          {mounted ? (
            <PulseSegmented
              ariaLabel="ribbon window"
              options={PULSE_RIBBON_WINDOW_NAMES}
              value={windowName}
              format={(name) => name}
              onChange={setWindowName}
            />
          ) : null}
        </div>
        {mounted ? (
          <PulseTransport
            mode={mode}
            range={range}
            speed={speed}
            playing={playing}
            secondsAgo={secondsAgo}
            failedMarks={replay.failedHours}
            indexedLate={anyIndexedLate(shownBlocks)}
            onMode={onMode}
            onRange={onRange}
            onSpeed={setSpeed}
            onPlaying={setPlaying}
            onScrub={replayFrom}
          />
        ) : null}
      </section>

      {live.status === "unavailable" ? (
        <p role="status" className="pulse-status">
          unavailable — the live feed has stopped answering
        </p>
      ) : null}

      <div className="grid gap-3.5 lg:grid-cols-[2fr_1fr]">
        <section className="panel p-5">
          <p className="microlabel mb-3 text-green">latest activity</p>
          <PulseLog entries={log} />
        </section>
        {ledgerPanel}
      </div>

      <LiveAnnouncer
        parts={[
          { count: announced.blocks, noun: "block" },
          { count: announced.movements, noun: "movement" },
        ]}
      />
    </div>
  );
}

/** The newest block's movements, so a reader without JavaScript still gets a written record. */
function seedLog(frame: PulseFrame, chainClasses: ReadonlyMap<string, string>): PulseLogEntry[] {
  const newest = frame.blocks.at(-1);
  if (newest === undefined) return [];
  const at = pulsePlacementSeconds(newest);
  const shortfall = coverageNote({ drawn: newest.events.length, total: newest.eventCount });
  const rows = newest.events
    .slice(0, PULSE_LOG_ROWS)
    .map((event) => movementEntry(`${newest.pools.hash}:${event.id}`, event, at, chainClasses));
  if (shortfall === null) return rows;
  // The block handed over a slice of its own count, and no single movement can say so.
  return [
    noteEntry(
      `${newest.pools.hash}:coverage`,
      newest.pools.hash,
      `${shortfall} · block ${formatCount(newest.pools.height)}`,
      at,
    ),
    ...rows,
  ];
}

/**
 * What the ledger box says in replay when it has no rows to draw, by the three states of
 * `replayLedger`.
 */
function replayLedgerNote(rows: readonly PulseLedgerRow[] | null | undefined): string | undefined {
  // The API does not carry an hour's outputs. Not "this hour had none": it was never asked, and
  // the live box's newest outputs under a clock set in the past would make a false claim about when.
  if (rows === null) return "newest outputs are shown live only · replay draws the movements";
  // No block covers this instant, so nothing here is measured. The boxes already say
  // `unavailable`; a sentence about outputs would report our unread hour as the chain having
  // moved none.
  if (rows === undefined) return undefined;
  return "no transparent outputs yet in this replay";
}

/** A log row for one drawn movement, its dot in the colour of the mark it names. */
function movementEntry(
  key: string,
  event: PulseEvent,
  atSeconds: number,
  chainClasses: ReadonlyMap<string, string>,
): PulseLogEntry {
  return { row: "movement", key, event, atSeconds, colorClass: colorOf(event, chainClasses) };
}

/** A log row that is a sentence about a block rather than one movement. */
function noteEntry(key: string, blockHash: string, text: string, atSeconds: number): PulseLogEntry {
  return { row: "note", key, blockHash, text, atSeconds, colorClass: "text-ink-faint" };
}

/** The dot beside a log row: the movement's destination, or its counterpart chain for a swap. */
function colorOf(event: PulseEvent, chainClasses: ReadonlyMap<string, string>): string {
  const leg = event.legs[0];
  if (leg === undefined) return "text-ink-dim";
  // A crossing is named by its counterpart chain wherever the value ended up — and a paired
  // one keeps its transaction's kind, so this cannot be asked of `kind`.
  if (isCrossing(event)) {
    return pulseNodeClass(leg.from === "transparent" ? leg.to : leg.from, chainClasses);
  }
  return pulseNodeClass(leg.to, chainClasses);
}
