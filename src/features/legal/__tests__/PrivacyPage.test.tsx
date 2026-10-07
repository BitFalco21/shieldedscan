import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PrivacyPage } from "../PrivacyPage";

/**
 * The privacy page's claims, pinned by shape rather than prose: the no-logging claim states
 * whose servers it covers, Netlify's own request records are disclosed, and no claim about an
 * analytics product being disabled appears without evidence behind it.
 */
describe("PrivacyPage", () => {
  it("scopes the no-access-logs claim to this project's own servers", () => {
    render(<PrivacyPage />);
    // The no-logging claim names whose servers it covers: Netlify serves the site.
    expect(screen.getByText(/This project’s own servers keep no access logs\./)).toBeTruthy();
  });

  it("discloses that Netlify records request IPs and shows them to this project", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).toMatch(/Netlify records each request it serves, including the IP address/);
    expect(text).toMatch(/visible to this project in its dashboard/);
    // No fixed retention window: it is plan-dependent, so a number here would silently become
    // false on a plan change.
    expect(text).not.toMatch(/\b(24 hours|7 days|30 days)\b/);
  });

  it("does not promise that any analytics product is disabled", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    // Inverted on purpose: a claim that an analytics product is disabled may only return with
    // evidence from the billing line.
    expect(text).not.toMatch(/analytics[^.]{0,40}\bnot enabled\b/i);
    expect(text).not.toMatch(/\bnot enabled\b[^.]{0,40}analytics/i);
  });

  it("keeps a readable space between a bolded lead and the sentence after it", () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    // JSX drops a newline adjacent to a tag, so the `{" "}` keeps the space between sentences;
    // prettier can rewrap around it.
    expect(text).toMatch(/access logs\. The reverse proxy/);
  });

  it("discloses the one localStorage key the theme switch writes, and no longer claims 'stores nothing'", () => {
    // A reader can choose a colour theme, and the choice is stored, so the page discloses it:
    // a slightly false promise is worse than a smaller true one.
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? "";
    expect(text).not.toMatch(/stores nothing in your browser/i);
    expect(text).not.toMatch(/Nothing is written to localStorage/i);
    expect(text).toMatch(/\btheme\b/);
    expect(text).toMatch(/localStorage/);
    expect(text).toMatch(/never (sent|transmitted)/i);
    // Cookies are still a flat no — that bullet is untouched and still true.
    expect(text).toMatch(/No cookies\./);
  });
});
