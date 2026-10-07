import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { getZnsName } from "@/fixtures/zns";
import type { ZnsEventAction } from "@/domain";
import { BADGE_BASE } from "@/components/Badge";
import { NamePage } from "../NamePage";

const zenith = getZnsName("zenith");

describe("NamePage", () => {
  it("leads with the name, its status and when it last changed", () => {
    const { container } = render(<NamePage lookup={zenith} />);
    // The heading is the name ALONE — a badge inside it fuses into its text.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("zenith.zcash");
    expect(container.querySelector("[data-zns-status]")!.textContent).toBe("registered");
    expect(container.querySelector("[data-zns-since]")!.textContent).toMatch(
      /^claimed \d{1,2} \w+ \d{4} · /,
    );
  });

  it("puts the whole address first, with a copy icon and an arrow to the page that re-checks it", () => {
    const { container } = render(<NamePage lookup={zenith} />);
    const address = zenith.registrations[0]!.address;
    expect(container.textContent).toContain(address);
    expect(screen.getByRole("button", { name: "Copy address" })).toBeTruthy();
    const arrow = screen.getByRole("link", { name: "Open address page" });
    expect(arrow.getAttribute("href")).toBe(`/address/${address}?name=zenith`);
  });

  it("shows no receiver breakdown — the address is the answer, its page has the detail", () => {
    const { container } = render(<NamePage lookup={zenith} />);
    expect(container.textContent).not.toContain("RECEIVES ON");
  });

  it("keeps the trust caveat beside the address, not as a banner", () => {
    render(<NamePage lookup={zenith} />);
    expect(screen.getByText(/not who holds this address/)).toBeTruthy();
  });

  it("shows the marketplace only when the name is for sale, with its price", () => {
    const listed = render(<NamePage lookup={getZnsName("abraham")} />).container;
    expect(listed.querySelector("[data-zns-status]")!.textContent).toBe("for sale");
    expect(listed.querySelector("[data-zns-listing]")!.textContent).toContain("2.50 ZEC");
    const buy = listed.querySelector("[data-zns-listing] [data-zns-explorer]")!;
    expect(buy.getAttribute("href")).toBe("https://www.zcashnames.com/explorer?search=abraham");
    expect(buy.getAttribute("rel")).toBe("noopener noreferrer");
    expect(buy.getAttribute("target")).toBe("_blank");
    const plain = render(<NamePage lookup={zenith} />).container;
    expect(plain.querySelector("[data-zns-listing]")).toBeNull();
    expect(plain.querySelector("[data-zns-explorer]")).toBeNull();
  });

  it("lists the history as an explorer table: action, date, block, transaction, price", () => {
    const { container } = render(<NamePage lookup={getZnsName("abraham")} />);
    const headers = [...container.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(headers).toEqual(["ACTION", "DATE", "BLOCK", "TRANSACTION", "POINTED AT", "PRICE"]);
    const rows = [...container.querySelectorAll("[data-zns-event]")];
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual([
      "listed",
      "updated",
      "claimed",
    ]);
    expect(rows[0]!.textContent).toContain("2.50 ZEC");
    expect(rows[0]!.querySelector('a[href^="/tx/"]')).not.toBeNull();
    expect(rows[0]!.querySelector('a[href^="/block/"]')!.className).toContain("text-green");
    // An action with no price says so with a dash, never an empty cell.
    expect(rows[1]!.querySelector("td:last-child")!.textContent).toBe("—");
    // …and so does a listing, which points the name nowhere.
    expect(rows[0]!.querySelectorAll("td")[4]!.textContent).toBe("—");
  });

  it("shows a released name as such, with no address and its history kept", () => {
    const { container } = render(<NamePage lookup={getZnsName("kazecstan")} />);
    expect(container.querySelector("[data-zns-status]")!.textContent).toBe("released");
    expect(container.querySelector("[data-zns-unregistered]")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Copy address" })).toBeNull();
    expect(container.querySelectorAll("[data-zns-event]")).toHaveLength(2);
  });

  it("credits its source without a referrer", () => {
    const { container } = render(<NamePage lookup={zenith} />);
    const link = container.querySelector('a[href="https://www.zcashnames.com"]')!;
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("gives each action its own colour, at the shared badge size", () => {
    // The three actions that point the name at an address each get a hue, the two price events
    // share gold, and the two undos stay neutral ink. The fixtures carry no BUY, SETPRICE or
    // DELIST, so the whole set is built here.
    const actions: ZnsEventAction[] = [
      "CLAIM",
      "UPDATE",
      "BUY",
      "LIST",
      "SETPRICE",
      "DELIST",
      "RELEASE",
    ];
    const base = zenith.history[0]!;
    const lookup = {
      ...zenith,
      history: actions.map((action, i) => ({ ...base, action, txid: `${i}`.repeat(64) })),
    };
    const { container } = render(<NamePage lookup={lookup} />);
    const badge = (a: ZnsEventAction) =>
      container.querySelector(`[data-zns-action="${a}"]`)!.firstElementChild!;
    const colour = (a: ZnsEventAction) =>
      [...badge(a).classList].find((c) => /^(flow-\d|text-(green|ink))/.test(c));
    expect(actions.map(colour)).toEqual([
      "flow-4",
      "flow-2",
      "flow-5",
      "flow-1",
      "flow-1",
      "text-ink-dim",
      "text-ink-faint",
    ]);
    for (const a of actions) expect(badge(a).className).toContain(BADGE_BASE);
    // The word still names the action; the colour is a second channel, never the only one.
    expect(container.querySelector('[data-zns-action="BUY"]')!.textContent).toBe("bought");
  });

  it("gives the status badge the same size as the history's badges", () => {
    const { container } = render(<NamePage lookup={getZnsName("abraham")} />);
    const status = container.querySelector("[data-zns-status]")!.firstElementChild!;
    const listed = container.querySelector('[data-zns-action="LIST"]')!.firstElementChild!;
    expect(status.className).toContain(BADGE_BASE);
    expect(listed.className).toContain(BADGE_BASE);
    // A live registration is in force, so the status reads in the accent.
    expect(status.className).toContain("text-green");
  });

  it("keeps a released name's header grey while its history keeps each action's colour", () => {
    // Green in the header means a registration is in force; a released name has none. The
    // history badges are categorical, not a state, so they keep their hues (RELEASE is neutral).
    const { container } = render(<NamePage lookup={getZnsName("kazecstan")} />);
    const status = container.querySelector("[data-zns-status]")!.firstElementChild!;
    expect(status.className).not.toContain("text-green");
    const release = container.querySelector('[data-zns-action="RELEASE"]')!.firstElementChild!;
    expect(release.className).toContain("text-ink-faint");
  });

  it("keeps the RESOLVES TO heading's name to the words, with its `?` beside it", () => {
    const { container } = render(<NamePage lookup={zenith} />);
    const heading = screen.getByRole("heading", { name: "RESOLVES TO" });
    expect(heading.querySelector("button, [role='tooltip']")).toBeNull();
    // The tip sits in the heading's row, which is its positioned ancestor.
    const tip = screen.getByRole("button", { name: "What is Resolves to?" });
    expect(tip.closest(".relative")).toBe(heading.parentElement);
    expect(container.querySelector("h2 [role='tooltip']")).toBeNull();
  });

  it("opens with one line above the title: the trail, ending in what this is", () => {
    render(<NamePage lookup={zenith} />);
    const trail = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(trail.textContent).toBe("HOME / ZCASH NAME");
  });

  it("puts the history in a panel, at the full column", () => {
    const { container } = render(<NamePage lookup={getZnsName("abraham")} />);
    expect(container.querySelector("table")!.closest(".panel")).not.toBeNull();
    expect(container.querySelector('[class*="max-w-5xl"]')).toBeNull();
  });
});
