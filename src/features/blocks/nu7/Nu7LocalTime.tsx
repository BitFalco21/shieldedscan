"use client";

import { useSyncExternalStore } from "react";

export interface Nu7LocalTimeProps {
  /** Estimated unix seconds of the activation block. */
  eta: number;
}

const noSubscription = () => () => {};

/**
 * The estimate in the reader's own time zone. Rendered in the browser only: the server knows no
 * reader's zone, and rendering it there would not match the browser's first paint.
 */
export function Nu7LocalTime({ eta }: Nu7LocalTimeProps) {
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  if (!inBrowser) return null;
  const text = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(new Date(eta * 1000));
  return <> · {text} your time</>;
}
