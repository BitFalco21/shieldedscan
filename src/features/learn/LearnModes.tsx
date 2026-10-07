"use client";

import { useState } from "react";
import { PracticeSim } from "./PracticeSim";
import { RealGuide } from "./RealGuide";
import { BTN, BTN_ON } from "./learn-ui";

export interface LearnModesProps {
  priceUsd: number | null;
  pageUrl: string;
}

type Mode = "practice" | "real";

/**
 * Practice first, then the real thing. Both halves stay mounted and the other is hidden, so a
 * reader who peeks at the real steps comes back to their practice exactly where they left it.
 */
export function LearnModes({ priceUsd, pageUrl }: LearnModesProps) {
  const [mode, setMode] = useState<Mode>("practice");
  const choose = (next: Mode) => {
    setMode(next);
    document.getElementById("learn-modes")?.scrollIntoView({ block: "start" });
  };

  return (
    <div id="learn-modes" className="grid scroll-mt-4 gap-5">
      <div role="group" aria-label="Mode" className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={mode === "practice"}
          onClick={() => setMode("practice")}
          className={mode === "practice" ? BTN_ON : BTN}
        >
          practice with test ZEC
        </button>
        <button
          type="button"
          aria-pressed={mode === "real"}
          onClick={() => setMode("real")}
          className={mode === "real" ? BTN_ON : BTN}
        >
          do it for real
        </button>
      </div>
      <div hidden={mode !== "practice"}>
        <PracticeSim
          priceUsd={priceUsd}
          active={mode === "practice"}
          onDoItForReal={() => choose("real")}
        />
      </div>
      <div hidden={mode !== "real"}>
        <RealGuide priceUsd={priceUsd} pageUrl={pageUrl} />
      </div>
    </div>
  );
}
