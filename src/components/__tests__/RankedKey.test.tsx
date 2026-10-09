import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RankedKey, type RankedKeyProps } from "../RankedKey";

const ITEMS = [
  { key: "OTHER", label: "Other chains", colorClass: "flow-rest", value: 500 },
  { key: "BTC", label: "Bitcoin", colorClass: "flow-3", value: 100 },
  { key: "ETH", label: "Ethereum", colorClass: "flow-1", value: 400 },
];

const draw = (props: Partial<RankedKeyProps> = {}) =>
  render(
    <RankedKey
      items={ITEMS}
      caption="All months · 1,000 ZEC"
      formatValue={(v) => `${v} ZEC`}
      pinnedLast={["OTHER"]}
      highlighted={null}
      onHighlight={() => {}}
      {...props}
    />,
  );

const rows = () => screen.getAllByRole("row").map((r) => r.textContent ?? "");

describe("RankedKey", () => {
  it("ranks largest first, keeps the fold last whatever its size, and states each share", () => {
    draw();
    expect(rows()).toEqual([
      "Ethereum400 ZEC40.0%",
      "Bitcoin100 ZEC10.0%",
      "Other chains500 ZEC50.0%",
    ]);
  });

  it("names what the figures cover", () => {
    draw();
    expect(screen.getByText("All months · 1,000 ZEC")).toBeTruthy();
  });

  it("prints no share over a zero total, rather than dividing by it", () => {
    draw({ items: ITEMS.map((i) => ({ ...i, value: 0 })) });
    expect(rows().every((r) => r.endsWith("—"))).toBe(true);
  });

  it("reports the row under the pointer, and fades the others while one is highlighted", () => {
    const onHighlight = vi.fn();
    draw({ onHighlight, highlighted: "BTC" });
    fireEvent.pointerEnter(screen.getByText("Ethereum").closest("tr")!);
    expect(onHighlight).toHaveBeenCalledWith("ETH");
    expect(screen.getByText("Ethereum").closest("tr")!.className).toContain("opacity-35");
    expect(screen.getByText("Bitcoin").closest("tr")!.className).not.toContain("opacity-35");
  });
});
