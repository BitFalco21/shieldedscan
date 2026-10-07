import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Redacted } from "@/components/Redacted";

describe("Redacted", () => {
  it("renders the canonical accessible redaction bar", () => {
    const { container } = render(<Redacted className="text-xs" />);
    expect(container.innerHTML).toBe(
      '<span role="img" aria-label="value shielded — encrypted on-chain" ' +
        'title="hidden by design — encrypted on-chain" class="redact text-xs">▓▓▓▓▓▓</span>',
    );
  });

  it("sizes the bar by glyph count, or shows the caller's exact text", () => {
    const { container, rerender } = render(<Redacted glyphs={3} />);
    expect(container.textContent).toBe("▓▓▓");
    expect(container.firstElementChild?.className).toBe("redact");
    rerender(<Redacted glyphs="▒▓░" />);
    expect(container.textContent).toBe("▒▓░");
  });

  it("takes a more specific spoken name without changing the tooltip", () => {
    const { getByRole } = render(<Redacted label="pool contents shielded" />);
    const bar = getByRole("img");
    expect(bar.getAttribute("aria-label")).toBe("pool contents shielded");
    expect(bar.getAttribute("title")).toBe("hidden by design — encrypted on-chain");
  });

  it("is hidden from assistive technology when decorative", () => {
    const { container, queryByRole } = render(<Redacted decorative glyphs={2} />);
    expect(queryByRole("img")).toBeNull();
    const bar = container.firstElementChild;
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(bar?.hasAttribute("title")).toBe(false);
    expect(bar?.className).toBe("redact");
  });
});
