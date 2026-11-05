"use client";

import { useState } from "react";
import Link from "@/components/Link";
import { consumeNu7Watched } from "./nu7-arrival";

export interface Nu7ActivatedBannerProps {
  className?: string;
}

/**
 * The flag on the activation block's page. It plays a short reveal only for a reader whose tab
 * watched the countdown reach this block; anyone else gets it still.
 */
export function Nu7ActivatedBanner({ className = "" }: Nu7ActivatedBannerProps) {
  // Read once, at mount: the flag is consumed so a later visit in the same tab renders still.
  const [reveal] = useState(consumeNu7Watched);
  return (
    <p
      className={`flex items-center gap-2.5 border border-warn-edge bg-warn-wash px-3 py-2.5 text-[13px] text-ink-bright ${
        reveal ? "nu7-reveal" : ""
      } ${className}`}
    >
      <span aria-hidden="true" className="text-warn">
        ⚡
      </span>
      NU7 activated at this block
      <Link href="/network/upgrade" className="ml-auto whitespace-nowrap text-warn">
        upgrade →
      </Link>
    </p>
  );
}
