import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgentConsole } from "../../AgentConsole";
import { newExchange } from "../../exchange";
import { clearHandoff, handOff, peekHandoff } from "../handoff";

/**
 * The bubble's ↗: the turns cross into the console in memory, once, and nothing is left behind
 * for a later visit to the console to pick up.
 */
afterEach(() => clearHandoff());

describe("bubble handoff", () => {
  it("an empty conversation leaves nothing to carry", () => {
    handOff([]);
    expect(peekHandoff()).toBeNull();
  });

  it("the console opens on the carried turns and lets go of them", () => {
    const turn = {
      ...newExchange(4, "what happened in block 2481032?", 0),
      answer: "Two transactions.",
      status: "complete" as const,
    };
    handOff([turn]);
    render(<AgentConsole />);
    expect(screen.getByText("what happened in block 2481032?")).toBeTruthy();
    expect(screen.getByText("Two transactions.")).toBeTruthy();
    expect(peekHandoff()).toBeNull();
  });
});
