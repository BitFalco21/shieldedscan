import { expect, test } from "@playwright/test";

/**
 * `/network` — what only interaction can show. The whole-site sweeps cover the tabs at rest
 * (overflow, contrast, one h1, no NaN, valid SVG, the filter state machine on the nodes list);
 * this file touches the controls and pins the invariant the page is built on:
 *
 * - No address anywhere in the DOM of any tab — the server publishes derived facts only, the
 *   adapter throws on an address-shaped string, and this is the third layer, at the rendered
 *   page. Subnet labels (`a.b.c.x`) pass; a fourth numeric octet does not.
 * - The lens flips the svg's `data-lens` and the computed fill of a cell, so colour is a class
 *   family switched by one attribute rather than a re-render.
 * - The ghost toggle removes the never-answered squares.
 * - Zoom transforms the map and reset restores it.
 * - A software chip survives a page turn on the nodes list.
 * - The sky's canvas is a labelled image once the ghosts have loaded, and pinning a hub from the
 *   readout's list fills the readout without a pointer.
 * - The OURS tile is marked and never adds into a crawl figure.
 * - Nothing leaves the origin.
 */

const TABS = ["/network", "/network/map", "/network/software", "/network/health", "/network/nodes"];
const IPV4 = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/;

test.describe("/network", () => {
  for (const tab of TABS) {
    test(`${tab} renders no address-shaped string`, async ({ page }) => {
      await page.goto(tab);
      await expect(page.locator("main")).toBeVisible();
      const html = await page.locator("main").evaluate((el) => el.outerHTML);
      expect(html).not.toMatch(IPV4);
      expect(html).not.toMatch(/\.onion\b/i);
      // The subnet grammar the health tab uses must survive the same sweep.
      if (tab === "/network/health") expect(html).toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.x/);
    });
  }

  test("the lens is one attribute and the cell's computed fill follows it", async ({ page }) => {
    await page.goto("/network/map");
    const map = page.locator(".net-map");
    await expect(map).toHaveAttribute("data-lens", "client");
    const cell = page.locator(".net-cell").first();
    const before = await cell.evaluate((el) => getComputedStyle(el).fill);
    await page.getByRole("button", { name: "crawls answered" }).click();
    await expect(map).toHaveAttribute("data-lens", "uptime");
    await expect(page.getByRole("button", { name: "crawls answered" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const after = await cell.evaluate((el) => getComputedStyle(el).fill);
    expect(after).not.toBe(before);
    // The legend followed the lens.
    await expect(page.locator('aside[role="status"]')).toContainText("crawls answered");
  });

  test("the ghost toggle removes the never-answered squares and zoom is a transform", async ({
    page,
  }) => {
    const offOrigin: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!url.startsWith("http://localhost") && !url.startsWith("http://127.0.0.1"))
        offOrigin.push(url);
    });
    await page.goto("/network/map");
    await expect(page.locator(".net-ghost").first()).toBeAttached();
    await page.getByRole("checkbox").uncheck();
    await expect(page.locator(".net-ghost")).toHaveCount(0);
    await expect(page.locator(".net-cell").first()).toBeAttached();

    const group = page.locator(".net-map svg > g");
    await expect(group).toHaveAttribute("transform", "translate(0 0) scale(1)");
    await page.getByRole("button", { name: "Zoom in" }).click();
    expect(await group.getAttribute("transform")).toMatch(/scale\(1\.5/);
    await page.getByRole("button", { name: "Reset the map view" }).click();
    await expect(group).toHaveAttribute("transform", "translate(0 0) scale(1)");
    expect(offOrigin).toEqual([]);
  });

  test("hovering a cell fills the readout with a place, never an address", async ({ page }) => {
    await page.goto("/network/map");
    const cell = page.locator(".net-cell").first();
    const label = (await cell.getAttribute("aria-label")) ?? "";
    // Picking is nearest-cell on the svg (adjacent cells overlap), so the pointer moves to the
    // cell's centre rather than hovering the rect itself — after scrolling the map into view,
    // since a mouse move to a point below the viewport reaches nothing.
    await page.locator(".net-map").scrollIntoViewIfNeeded();
    const box = (await cell.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const readout = page.locator('aside[role="status"]');
    await expect(readout).toContainText("nodes here");
    await expect(readout).toContainText("A 1° cell, not an address");
    expect(label).not.toMatch(IPV4);
  });

  test("the OURS tile is marked and its count adds into no crawl figure", async ({ page }) => {
    await page.goto("/network");
    const ours = page.locator('[data-basis="ours"]');
    await expect(ours).toHaveCount(1);
    await expect(ours).toContainText("peers on our node");
    await expect(ours).toContainText("ours");
    const floors = page.locator('[data-basis="floor"]');
    await expect(floors).toHaveCount(4);
    const oursText = await ours.innerText();
    const count = /(\d[\d,]*)/.exec(oursText.replace("peers on our node", ""))?.[1];
    if (count && count !== "not read") {
      for (const text of await floors.allInnerTexts()) {
        expect(text.split("\n")[1]?.startsWith(count)).toBe(false);
      }
    }
  });

  test("a software chip survives a page turn on the nodes list", async ({ page }) => {
    await page.goto("/network/nodes");
    const sentence = page.locator(".net-found");
    await expect(sentence).toContainText("A total of");
    const chips = page.getByRole("navigation", { name: "Filter by software" });
    const zakura = chips.getByRole("link", { name: "Zakura" });
    await zakura.click();
    await expect(page).toHaveURL(/client=Zakura/);
    await expect(sentence).toContainText("Zakura nodes found");
    await expect(sentence).toContainText("· of");
    const older = page.getByRole("link", { name: "Older page" });
    if ((await older.count()) > 0 && (await older.getAttribute("aria-disabled")) !== "true") {
      await older.click();
      await expect(page).toHaveURL(/client=Zakura/);
      await expect(page).toHaveURL(/before=/);
    }
    // The hosting menu carries the software filter too.
    await page.locator('summary[aria-label$="filter by hosting network"]').click();
    const first = page
      .getByRole("navigation", { name: "Filter by hosting network" })
      .getByRole("link")
      .nth(1);
    expect(await first.getAttribute("href")).toContain("client=Zakura");
  });

  test("the sky is a labelled canvas after the ghosts load, and the list pins a hub", async ({
    page,
  }) => {
    await page.goto("/network");
    const canvas = page.getByRole("img", { name: /answering nodes as hubs/ });
    await expect(canvas).toBeVisible();
    // The never-answered population arrives after mount from the first-party route.
    await expect(page.locator("[data-ghosts]")).not.toHaveAttribute("data-ghosts", "loading", {
      timeout: 15_000,
    });
    await expect(page.locator("[data-ghosts]")).toContainText("not answering ·");
    await expect(canvas).toHaveAttribute("aria-label", /advertised addresses not answering/);
    const readout = page.locator('aside[role="status"]');
    await expect(readout).toContainText("most advertised");
    const pin = readout.getByRole("button", { name: /^Pin / }).first();
    const id = /node ([0-9a-f]{12})/.exec((await pin.getAttribute("aria-label")) ?? "")?.[1];
    await pin.click();
    await expect(readout).toContainText(id ?? "no-id");
    await expect(readout).toContainText("advertised by");
    await page.keyboard.press("Escape");
    await expect(readout).toContainText("most advertised");
  });

  test("a wheel over the sky or the map is cancelled, so a pinch cannot zoom the page", async ({
    page,
  }) => {
    // React's onWheel is passive and its preventDefault is ignored; only a native non-passive
    // listener cancels the browser's page zoom. dispatchEvent returns false when cancelled.
    for (const [path, selector] of [
      ["/network", ".net-sky"],
      ["/network/map", ".net-map"],
    ] as const) {
      await page.goto(path);
      await expect(page.locator(selector)).toBeVisible();
      const cancelled = await page.locator(selector).evaluate((el) => {
        const ev = new WheelEvent("wheel", {
          deltaY: -100,
          ctrlKey: true,
          cancelable: true,
          bubbles: true,
        });
        return !el.dispatchEvent(ev);
      });
      expect(cancelled, `${path} ${selector} did not cancel the wheel event`).toBe(true);
    }
  });

  test("no tab carries an inline style", async ({ page }) => {
    for (const tab of TABS) {
      await page.goto(tab);
      const styled = await page.locator("main [style]").count();
      expect(styled, `${tab} has ${styled} inline-styled elements`).toBe(0);
    }
  });
});
