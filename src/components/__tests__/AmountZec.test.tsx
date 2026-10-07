import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AmountZec } from "../AmountZec";

describe("AmountZec", () => {
  it("renders a shielded value as a labelled redaction bar, never a zero", () => {
    render(<AmountZec zat={null} />);
    const redaction = screen.getByRole("img", { name: /value shielded/ });
    expect(redaction.getAttribute("title")).toContain("hidden by design");
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });

  it("renders a real amount in ZEC", () => {
    render(<AmountZec zat={1_240_210_000} />);
    expect(screen.getByText("12.4021 ZEC")).toBeDefined();
  });

  it("renders a genuine zero as zero, not as shielded", () => {
    render(<AmountZec zat={0} />);
    expect(screen.getByText("0.00 ZEC")).toBeDefined();
    expect(screen.queryByRole("img", { name: /value shielded/ })).toBeNull();
  });
});
