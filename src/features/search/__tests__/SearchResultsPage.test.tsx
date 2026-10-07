import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SearchResultsPage } from "../SearchResultsPage";

describe("SearchResultsPage", () => {
  it("prompts when the query is empty", () => {
    render(<SearchResultsPage state={{ kind: "prompt" }} query="" />);
    expect(screen.getByText(/What are you looking for/)).toBeDefined();
  });

  it("echoes an invalid query without pretending it is on-chain", () => {
    render(<SearchResultsPage state={{ kind: "invalid" }} query="hello world" />);
    expect(screen.getByText("hello world")).toBeDefined();
  });

  it("reports a well-formed query that matches nothing on chain", () => {
    render(<SearchResultsPage state={{ kind: "not-found" }} query={"ab".repeat(32)} />);
    expect(screen.getByText(/Valid shape, but nothing found/)).toBeDefined();
    expect(screen.getByText("ab".repeat(32))).toBeDefined();
  });

  it("explains a height beyond the tip and estimates the wait", () => {
    render(
      <SearchResultsPage
        state={{ kind: "beyond-tip", height: 2_481_100, tip: 2_481_032 }}
        query="2481100"
      />,
    );
    expect(screen.getByText(/hasn't been mined yet/)).toBeDefined();
  });

  it("offers both targets when a hash is ambiguous", () => {
    render(
      <SearchResultsPage
        state={{
          kind: "ambiguous",
          hash: "ab".repeat(32),
          blockHref: "/block/x",
          txHref: "/tx/x",
        }}
        query={"ab".repeat(32)}
      />,
    );
    expect(screen.getByRole("link", { name: /View as block/ })).toBeDefined();
    expect(screen.getByRole("link", { name: /View as transaction/ })).toBeDefined();
  });

  it("says a name is unregistered, writing it as name.zcash", () => {
    render(<SearchResultsPage state={{ kind: "name-not-found", name: "nobody" }} query="nobody" />);
    expect(screen.getByText(/No one has registered this name/)).toBeTruthy();
    expect(screen.getByText("nobody.zcash")).toBeTruthy();
    // The next step is the registry's own page for that name, opened in a new tab.
    const chip = screen.getByRole("link", { name: /see it on zcashnames\.com/ });
    expect(chip.getAttribute("href")).toBe("https://www.zcashnames.com/explorer?search=nobody");
    expect(chip.getAttribute("target")).toBe("_blank");
    expect(chip.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("offers no registry link while the registry is unreadable", () => {
    render(
      <SearchResultsPage state={{ kind: "name-unavailable", name: "zenith" }} query="zenith" />,
    );
    expect(screen.queryByRole("link", { name: /zcashnames\.com/ })).toBeNull();
  });

  it("never reports an unreadable registry as a miss", () => {
    render(
      <SearchResultsPage state={{ kind: "name-unavailable", name: "zenith" }} query="zenith" />,
    );
    expect(screen.getByText(/Name lookup unavailable/)).toBeTruthy();
    expect(screen.queryByText(/No one has registered/)).toBeNull();
  });
});
