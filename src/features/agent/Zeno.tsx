import { SHIELD } from "@/components/PrivacyShield";
import { MAX_BLOCKS, type ZenoExpression, type ZenoSlow } from "./zeno-mood";

/**
 * Zeno, the agent: a terminal-headed bot with the site's own `zeno>` prompt in a bubble.
 *
 * Built from the site's vocabulary: the bubble is the prompt grammar, its cursor is the logo's
 * blinking block, and the chest carries the exact `SHIELD` path `PrivacyShield` draws. Colours
 * are token classes only, so the hue themes recolour it; every animation is a class in
 * `globals.css` (`.zeno-*`), because inline style props are banned in `src/`.
 *
 * Rules it keeps:
 *  - No glow: the glow budget is rationed and a mascot is not on the list.
 *  - No SVG `id`: a filter, pattern or clip would collide when a second instance rendered, and
 *    this page renders up to three (the rail, the phone bar, a phone turn's stage).
 *  - Decorative (`aria-hidden`): the trail says in words what Zeno acts out. Animations stop
 *    under reduced motion, and the static pose still shows the state through the face.
 *  - The stack is honest: one block per lookup that really ran (`zenoMood`), never a progress
 *    bar pretending to know how far along the answer is.
 */

/** The coordinate box for each framing, in the figure's own 512-unit space. */
const VIEW_BOX = {
  head: "104 52 304 254",
  stage: "16 -44 520 520",
  bubble: "84 6 432 468",
  plain: "84 52 336 422",
} as const;

const FIGURE_MOTION: Partial<Record<ZenoExpression, string>> = {
  thinking: "zeno-float",
  writing: "zeno-float",
  reading: "zeno-bob",
  answered: "zeno-hop",
  stuck: "zeno-shrug",
};

const LIVE: readonly ZenoExpression[] = ["thinking", "reading", "writing"];

export interface ZenoProps {
  expression?: ZenoExpression;
  /** 1 adds a sweat drop, 2 a second drop and a hand to the face. Live turns only. */
  slow?: ZenoSlow;
  /** Blocks on the stack beside Zeno. Drawn only with `stage`. */
  blocks?: number;
  /** `head` is the face alone, for a bar; `full` is the whole figure. */
  variant?: "full" | "head";
  /** Room for the block stack, the confetti and the smoke. Off for a static hero. */
  stage?: boolean;
  /** The `zeno>` prompt bubble. Ignored for `head`. */
  bubble?: boolean;
  className?: string;
}

export function Zeno({
  expression = "ready",
  slow = 0,
  blocks = 0,
  variant = "full",
  stage = false,
  bubble = true,
  className,
}: ZenoProps) {
  const head = variant === "head";
  const onStage = !head && stage;
  const withBubble = !head && bubble;
  const stacked = onStage ? Math.max(0, Math.min(MAX_BLOCKS, Math.floor(blocks))) : 0;
  const stuck = expression === "stuck";
  const answered = expression === "answered";
  const live = LIVE.includes(expression);
  const figure = FIGURE_MOTION[expression] ?? "";
  const viewBox = head
    ? VIEW_BOX.head
    : onStage
      ? VIEW_BOX.stage
      : withBubble
        ? VIEW_BOX.bubble
        : VIEW_BOX.plain;

  return (
    <svg
      viewBox={viewBox}
      aria-hidden
      data-zeno
      data-zeno-expression={expression}
      data-zeno-blocks={stacked}
      data-zeno-slow={slow}
      className={["h-auto shrink-0 overflow-visible", className ?? ""].join(" ").trim()}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {!head && (
        <ellipse
          cx="256"
          cy="456"
          rx="104"
          ry="13"
          className={["zeno-shadow fill-green", shadowMotion(figure)].join(" ")}
          opacity="0.12"
        />
      )}

      {onStage && <BlockStack blocks={stacked} jump={answered} feed={expression === "writing"} />}

      <g className={["zeno-figure", figure].join(" ")}>
        {!head && <Body expression={expression} slow={slow} />}
        <Head expression={expression} slow={slow} head={head} />
        {!head && !stuck && slow >= 2 && (
          // A hand to the face, drawn after the head so it sits in front of it.
          <g className="zeno-scratch">
            <rect
              x="160"
              y="252"
              width="32"
              height="78"
              rx="16"
              className="fill-green-dim"
              transform="rotate(-20 176 326)"
            />
            <circle cx="151" cy="256" r="16" className="fill-green-dim" />
          </g>
        )}
      </g>

      {withBubble && (
        <g>
          <path
            d="M352 12 H488 Q510 12 510 34 V70 Q510 92 488 92 H380 L338 114 L356 92 H352 Q330 92 330 70 V34 Q330 12 352 12 Z"
            className="fill-panel stroke-green"
            strokeWidth="4"
          />
          <text x="352" y="62" fontSize="26" fontWeight="700" className="fill-green font-mono">
            zeno&gt;
          </text>
          {live ? (
            // Working: a three-dot wave where the idle cursor was.
            <g className="zeno-dots">
              <rect x="438" y="44" width="12" height="12" rx="2" className="zeno-dot fill-green" />
              <rect x="456" y="44" width="12" height="12" rx="2" className="zeno-dot fill-green" />
              <rect x="474" y="44" width="12" height="12" rx="2" className="zeno-dot fill-green" />
            </g>
          ) : (
            <rect x="438" y="40" width="14" height="26" rx="2" className="zeno-cursor fill-green" />
          )}
        </g>
      )}

      {onStage && stuck && (
        // A fizzle over the antenna. The blocks stay lit: the data was read, the words failed.
        <g className="zeno-smoke">
          <circle cx="262" cy="46" r="10" className="zeno-puff fill-ink" />
          <circle cx="270" cy="40" r="13" className="zeno-puff fill-ink" />
          <circle cx="250" cy="42" r="9" className="zeno-puff fill-ink" />
        </g>
      )}

      {onStage && answered && (
        // Mounted only on the answered render, so it plays once per answer and never on a
        // re-render of the same one.
        <g className="zeno-confetti">
          {CONFETTI.map((fill, i) => (
            <rect key={i} x="248" y="80" width="16" height="16" rx="3" className={fill} />
          ))}
        </g>
      )}
    </svg>
  );
}

/** Twelve pieces in three inks; each flies its own path (`.zeno-confetti > rect:nth-child`). */
const CONFETTI = Array.from(
  { length: 12 },
  (_, i) => ["fill-green", "fill-ink-bright", "fill-green-dim"][i % 3]!,
);

function shadowMotion(figure: string): string {
  if (figure === "zeno-float") return "zeno-shadow-float";
  if (figure === "zeno-bob") return "zeno-shadow-bob";
  if (figure === "zeno-hop") return "zeno-shadow-hop";
  return "";
}

/** One block per lookup, dropped onto a stack beside Zeno; read into the answer while writing. */
function BlockStack({ blocks, jump, feed }: { blocks: number; jump: boolean; feed: boolean }) {
  return (
    <g>
      {blocks > 0 && (
        <ellipse cx="49" cy="457" rx="32" ry="6" className="fill-green" opacity="0.12" />
      )}
      <g className={["zeno-stack", jump ? "zeno-jump" : ""].join(" ")}>
        {Array.from({ length: blocks }, (_, k) => (
          <g key={k} className="zeno-block">
            <rect
              x="24"
              y={404 - 56 * k}
              width="50"
              height="50"
              rx="7"
              className="fill-panel stroke-green"
              strokeWidth="5"
            />
            <rect
              x="39"
              y={419 - 56 * k}
              width="20"
              height="20"
              rx="3"
              className={["fill-green-dim", feed ? "zeno-feed" : ""].join(" ")}
            />
          </g>
        ))}
      </g>
    </g>
  );
}

function Body({ expression, slow }: { expression: ZenoExpression; slow: ZenoSlow }) {
  const stuck = expression === "stuck";
  const answered = expression === "answered";
  return (
    <g>
      <rect x="234" y="300" width="44" height="16" rx="4" className="fill-green-dim" />
      <rect
        x="176"
        y="310"
        width="160"
        height="116"
        rx="42"
        className="fill-panel stroke-green"
        strokeWidth="6"
      />
      <path transform="translate(226 330) scale(2.5)" d={SHIELD} className="fill-green" />
      <circle cx="256" cy="358" r="6.5" className="fill-bg" />
      <rect x="252.5" y="360" width="7" height="15" rx="2" className="fill-bg" />

      {stuck ? (
        // The shrug: both forearms up, palms out.
        <g>
          <rect
            x="150"
            y="318"
            width="30"
            height="58"
            rx="15"
            className="fill-green-dim"
            transform="rotate(115 165 326)"
          />
          <circle cx="118" cy="303" r="14" className="fill-green-dim" />
          <rect
            x="332"
            y="318"
            width="30"
            height="58"
            rx="15"
            className="fill-green-dim"
            transform="rotate(-115 347 326)"
          />
          <circle cx="394" cy="303" r="14" className="fill-green-dim" />
        </g>
      ) : (
        <>
          {slow < 2 && (
            <rect
              x="146"
              y="322"
              width="32"
              height="70"
              rx="16"
              className="fill-green-dim"
              transform="rotate(16 162 330)"
            />
          )}
          {answered ? (
            // A wave.
            <g>
              <rect
                x="340"
                y="250"
                width="32"
                height="74"
                rx="16"
                className="fill-green-dim"
                transform="rotate(38 356 322)"
              />
              <circle cx="395" cy="268" r="17" className="fill-green-dim" />
            </g>
          ) : (
            <g className={expression === "writing" ? "zeno-scribble" : undefined}>
              <rect
                x="332"
                y="322"
                width="32"
                height="70"
                rx="16"
                className="fill-green-dim"
                transform="rotate(-16 348 330)"
              />
            </g>
          )}
        </>
      )}

      <rect x="198" y="418" width="42" height="34" rx="13" className="fill-green-dim" />
      <rect x="272" y="418" width="42" height="34" rx="13" className="fill-green-dim" />
    </g>
  );
}

function Head({
  expression,
  slow,
  head,
}: {
  expression: ZenoExpression;
  slow: ZenoSlow;
  head: boolean;
}) {
  return (
    <g className={expression === "thinking" ? "zeno-head zeno-tilt" : "zeno-head"}>
      {/* antenna: the logo's block cursor, still here; the bubble's is the one that blinks */}
      <line x1="256" y1="120" x2="256" y2="86" className="stroke-green-dim" strokeWidth="7" />
      <rect x="244" y="58" width="24" height="30" rx="3" className="fill-green" />
      {!head && expression === "reading" && (
        // The antenna pings while a lookup runs.
        <g className="zeno-arcs">
          <path
            d="M233.5 60 A26 26 0 0 1 278.5 60"
            className="zeno-arc stroke-green-dim"
            strokeWidth="5"
          />
          <path
            d="M221.4 53 A40 40 0 0 1 290.6 53"
            className="zeno-arc stroke-green-dim"
            strokeWidth="5"
          />
          <path
            d="M209.2 46 A54 54 0 0 1 302.8 46"
            className="zeno-arc stroke-green-dim"
            strokeWidth="5"
          />
        </g>
      )}
      <rect x="112" y="176" width="28" height="66" rx="12" className="fill-green-dim" />
      <rect x="372" y="176" width="28" height="66" rx="12" className="fill-green-dim" />
      <rect
        x="134"
        y="118"
        width="244"
        height="184"
        rx="52"
        className="fill-panel stroke-green"
        strokeWidth="6"
      />
      <rect
        x="160"
        y="142"
        width="192"
        height="136"
        rx="34"
        className="fill-bg stroke-green-dim"
        strokeWidth="3"
      />
      <Face expression={expression} />
      {slow >= 1 && (
        <path
          d="M388 126 C392 134 398 140 398 146 A10 10 0 0 1 378 146 C378 140 384 134 388 126 Z"
          className="zeno-sweat fill-ink"
        />
      )}
      {slow >= 2 && (
        <path
          d="M124 128 C128 136 134 142 134 148 A10 10 0 0 1 114 148 C114 142 120 136 124 128 Z"
          className="zeno-sweat zeno-sweat-late fill-ink"
        />
      )}
    </g>
  );
}

/** The cheeks every content face shares; a happier face blushes harder. */
function Cheeks({ strong = false }: { strong?: boolean }) {
  return (
    <>
      <rect
        x="180"
        y="232"
        width="20"
        height="9"
        rx="4.5"
        className="fill-green"
        opacity={strong ? "0.55" : "0.35"}
      />
      <rect
        x="312"
        y="232"
        width="20"
        height="9"
        rx="4.5"
        className="fill-green"
        opacity={strong ? "0.55" : "0.35"}
      />
    </>
  );
}

function Face({ expression }: { expression: ZenoExpression }) {
  switch (expression) {
    case "thinking":
      // Happy, closed eyes: it is thinking.
      return (
        <g>
          <path d="M200 214 Q218 190 236 214" className="stroke-green" strokeWidth="9" />
          <path d="M276 214 Q294 190 312 214" className="stroke-green" strokeWidth="9" />
          <Cheeks />
          <path d="M238 240 Q256 256 274 240" className="stroke-green" strokeWidth="6" />
        </g>
      );
    case "reading":
      // Eyes scanning left and right, mouth a flat line of concentration.
      return (
        <g>
          <g className="zeno-read">
            <rect x="199" y="186" width="26" height="34" rx="12" className="fill-green" />
            <rect x="275" y="186" width="26" height="34" rx="12" className="fill-green" />
            <circle cx="206" cy="196" r="5" className="fill-ink-bright" />
            <circle cx="282" cy="196" r="5" className="fill-ink-bright" />
          </g>
          <path d="M245 245 L267 245" className="stroke-green" strokeWidth="6" />
        </g>
      );
    case "writing":
      // Eyes down at the page.
      return (
        <g>
          <rect x="209" y="196" width="28" height="32" rx="13" className="fill-green" />
          <rect x="285" y="196" width="28" height="32" rx="13" className="fill-green" />
          <circle cx="228" cy="219" r="5" className="fill-ink-bright" />
          <circle cx="304" cy="219" r="5" className="fill-ink-bright" />
          <Cheeks />
          <path d="M244 250 Q256 258 268 250" className="stroke-green" strokeWidth="5" />
        </g>
      );
    case "answered":
      return (
        <g>
          <rect x="203" y="182" width="30" height="38" rx="14" className="fill-green" />
          <rect x="279" y="182" width="30" height="38" rx="14" className="fill-green" />
          <circle cx="213" cy="193" r="6" className="fill-ink-bright" />
          <circle cx="289" cy="193" r="6" className="fill-ink-bright" />
          <Cheeks strong />
          <path d="M228 234 Q256 266 284 234" className="stroke-green" strokeWidth="7" />
        </g>
      );
    case "stuck":
      return (
        <g>
          <rect x="203" y="198" width="30" height="10" rx="5" className="fill-green" />
          <rect x="279" y="198" width="30" height="10" rx="5" className="fill-green" />
          <path d="M242 246 L270 246" className="stroke-green" strokeWidth="6" />
        </g>
      );
    default:
      // Ready: open eyes that blink now and then.
      return (
        <g>
          <g className="zeno-blink">
            <rect x="203" y="180" width="30" height="42" rx="14" className="fill-green" />
            <rect x="279" y="180" width="30" height="42" rx="14" className="fill-green" />
            <circle cx="213" cy="192" r="6" className="fill-ink-bright" />
            <circle cx="289" cy="192" r="6" className="fill-ink-bright" />
          </g>
          <Cheeks />
          <path d="M238 240 Q256 256 274 240" className="stroke-green" strokeWidth="6" />
        </g>
      );
  }
}
