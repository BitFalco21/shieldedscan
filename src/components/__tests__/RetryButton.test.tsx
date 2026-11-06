import { fireEvent, render, screen } from "@testing-library/react";
import { useRouter } from "next/navigation";
import { describe, expect, it, vi } from "vitest";
import { RetryButton } from "@/components/RetryButton";

describe("RetryButton", () => {
  it("is a real button, 44 px or more, that asks the router for a fresh render", () => {
    const onRetry = vi.fn();
    render(<RetryButton onRetry={onRetry} />);
    const button = screen.getByRole("button", { name: "Try again" });
    expect(button.className).toMatch(/\bmin-h-11\b/);
    expect(button.className).toMatch(/\bmin-w-11\b/);
    fireEvent.click(button);
    expect(useRouter().refresh).toHaveBeenCalled();
    expect(onRetry).toHaveBeenCalled();
  });
});
