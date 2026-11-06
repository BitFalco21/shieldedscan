import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UPSTREAM_UNAVAILABLE_DIGEST } from "@/lib/transient-upstream";
import ErrorBoundary from "../error";

/**
 * The boundary tells an outage of the API from a bug of ours by the digest the data source
 * stamps, the one property of a server error production lets through.
 */

afterEach(() => vi.restoreAllMocks());

function renderWith(digest: string | undefined) {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const error = Object.assign(new Error("withheld in production"), { digest });
  render(<ErrorBoundary error={error} reset={() => {}} />);
}

describe("the route error boundary", () => {
  it("says the page did not load when the data behind it could not be read", () => {
    renderWith(UPSTREAM_UNAVAILABLE_DIGEST);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("This page didn't load");
    expect(screen.queryByText(/SOMETHING BROKE/)).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
    // The shared digest names no particular failure; it is not shown.
    expect(screen.queryByText(new RegExp(UPSTREAM_UNAVAILABLE_DIGEST))).toBeNull();
  });

  it("owns a bug as a bug, with its digest for a report", () => {
    renderWith("1234567890");
    expect(screen.getByText("SOMETHING BROKE")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/failed to render/);
    expect(screen.getByText("error 1234567890")).toBeTruthy();
  });
});
