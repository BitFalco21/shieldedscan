import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill } from "../StatusPill";

describe("StatusPill", () => {
  it.each([
    ["completed", "COMPLETED"],
    ["pending", "PENDING"],
    ["refunded", "REFUNDED"],
  ] as const)("renders the %s status", (status, label) => {
    render(<StatusPill status={status} />);
    expect(screen.getByText(label)).toBeDefined();
  });
});
