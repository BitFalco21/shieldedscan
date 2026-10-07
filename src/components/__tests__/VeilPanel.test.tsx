import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { VeilPanel } from "../VeilPanel";

describe("VeilPanel", () => {
  it("states what is hidden and why, and shows the public facts", () => {
    render(
      <VeilPanel
        title="Orchard pool · receiving"
        facts={[{ label: "NET TO SHIELDED", value: "+3.00 ZEC" }]}
      />,
    );
    expect(screen.getByText("Orchard pool · receiving")).toBeDefined();
    expect(screen.getByText(/hidden by design/)).toBeDefined();
    expect(screen.getByText(/viewing key/)).toBeDefined();
    expect(screen.getByText("NET TO SHIELDED")).toBeDefined();
    expect(screen.getByText("+3.00 ZEC")).toBeDefined();
  });
});
