"use client";

import { createContext } from "react";

/**
 * How a part of `/learn` hands Zeno a question: the drawer's wrapper provides `ask`, and every
 * "ask zeno" button calls it. Null when the agent is switched off for this deployment, so each
 * button renders nothing rather than a control that cannot work.
 */
export const AskZenoContext = createContext<((question: string) => void) | null>(null);

/**
 * Whether Zeno is on screen as the tour's guide. The practice reports it and the drawer's wrapper
 * hides its corner launcher meanwhile: Zeno is already there, talking, and a second Zeno in the
 * corner would sit on top of the dialogue box on a phone. A no-op where the agent is switched off.
 */
export const CoachPresenceContext = createContext<(present: boolean) => void>(() => {});
