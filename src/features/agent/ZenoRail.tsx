import type { ReactNode } from "react";
import { ZenoLive } from "./ZenoLive";
import type { ZenoTurn } from "./zeno-mood";

/**
 * Zeno's rail: the console's left column on a wide screen, and the slim bar above the
 * conversation on a phone. One element serves both, because it carries the page's only `<h1>`
 * and the disclosures, and rendering either twice is a defect.
 *
 * On a phone the `<aside>` is `display: contents` (`.zeno-rail`), so its three parts become
 * items of the frame's column and can be ordered: the head is the bar at the top, the about list
 * is hidden, and the disclosures move below the conversation. From `lg` the aside is a real box
 * again.
 *
 * Zeno persists through the whole conversation: working while a turn runs, celebrating an
 * answer, shrugging at a non-answer. There is no status pill beside it — the trail already says
 * in words what the turn is doing.
 */

const HOW_IT_ANSWERS: readonly { text: string; icon: string }[] = [
  {
    text: "looks every figure up",
    icon: "M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0zM20 20l-4.7-4.7",
  },
  { text: "shows each lookup", icon: "M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1" },
  { text: "links its sources", icon: "M7 17 17 7M9 7h8v8" },
  {
    // A key, struck through.
    text: "never asks for a key",
    icon: "M11 15.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0zM10 13l9-9M16 7l2 2M13.5 9.5l2 2M3 3l18 18",
  },
];

export interface ZenoRailProps {
  /** The turn Zeno acts out: the last exchange, or null with nothing asked. */
  turn: ZenoTurn | null;
  /** The disclosures, rendered once — at the foot of the rail, or below the console on a phone. */
  children?: ReactNode;
}

export function ZenoRail({ turn, children }: ZenoRailProps) {
  return (
    <aside
      aria-label="Zeno"
      className="zeno-rail zeno-wash lg:flex lg:w-[300px] lg:flex-none lg:flex-col lg:overflow-y-auto lg:rounded-md lg:border lg:border-edge-faint lg:px-[22px] lg:pt-[22px] lg:pb-4"
    >
      <div className="flex h-12 flex-none items-center gap-2.5 border-b border-edge-faint px-4 lg:block lg:h-auto lg:border-0 lg:px-0">
        <ZenoLive turn={turn} variant="head" className="w-[34px] lg:hidden" />
        <div className="hidden justify-center lg:flex">
          <ZenoLive turn={turn} stage className="zeno-rail-figure" />
        </div>
        <div className="microlabel mt-1.5 hidden lg:block">AI AGENT</div>
        <h1 className="zeno-wordmark w-fit text-sm lg:mt-1 lg:text-[80px]">ZENO</h1>
        <p className="mt-3.5 hidden text-[17px] font-bold text-ink-bright lg:block">
          ask the chain.
        </p>
        <p className="mt-1.5 hidden text-[12.5px] leading-relaxed text-ink-dim lg:block">
          Blocks, pools, swaps, prices and ZIPs — looked up live, with sources.
        </p>
      </div>

      <div className="zeno-rail-about">
        <div className="mt-5 mb-4 h-px bg-edge-faint" />
        <div className="microlabel">HOW ZENO ANSWERS</div>
        <ul className="mt-2.5 space-y-2 text-[12.5px] text-ink-dim">
          {HOW_IT_ANSWERS.map((item) => (
            <li key={item.text} className="flex items-center gap-2.5">
              <svg
                aria-hidden
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-green-dim"
              >
                <path d={item.icon} />
              </svg>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="order-last px-4 pt-6 lg:mt-auto lg:px-0 lg:pt-3">
        <p className="mb-2 text-[11px] text-ink-faint">this chat lives in this tab only</p>
        {children}
      </div>
    </aside>
  );
}
