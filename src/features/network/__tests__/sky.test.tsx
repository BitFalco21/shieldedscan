import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixtureDataSource } from "@/data/fixture-source";
import { HUB_RADIUS, hash01, layoutSky } from "../topology/sky-layout";
import { DEFAULT_CAMERA } from "../topology/sky-camera";
import { NO_MARKS, drawSky, pickSky, projectPoint } from "../topology/sky-draw";
import type { SkyPalette } from "../topology/sky-draw";
import { SkyCanvas } from "../topology/SkyCanvas";

/**
 * The sky, in three parts: the layout is deterministic and honours its geometry, the drawing
 * is a pure function of its arguments (proved against a recording stub of the 2D context — a
 * real canvas does not exist under jsdom), and the component is an enhancement: its readout
 * renders with the hubs alone, the never-answered population arrives after mount, and a hub
 * can be pinned from the list without a pointer.
 */

const hubs = await fixtureDataSource.getNetworkTopology("hubs");
const sky = await fixtureDataSource.getNetworkTopology("all");

const palette: SkyPalette = {
  panel: "#0a120a",
  green: "#2bff64",
  greenDim: "#17a344",
  ink: "#d9ffe4",
  inkDim: "#7fbf93",
  inkFaint: "#5f8f70",
  inkBright: "#f2fff5",
  flow1: "#e3b341",
  flow2: "#4c8dff",
  flow5: "#9d7bff",
  zakura: "#fd6798",
  zcashd: "#f4b728",
};

describe("sky layout", () => {
  it("is deterministic and keeps every hub inside its sphere", () => {
    const a = layoutSky(sky);
    const b = layoutSky(sky);
    expect(a).toEqual(b);
    expect(a.hubs).toHaveLength(sky.hubs.length);
    expect(a.ghosts).toHaveLength(sky.ghosts!.length);
    for (const p of a.hubs)
      expect(Math.hypot(p.x, p.y, p.z)).toBeLessThanOrEqual(HUB_RADIUS + 1e-9);
  });

  it("hangs a lone-advertiser address farther out than a well-known one", () => {
    const layout = layoutSky(sky);
    const radius = (i: number) =>
      Math.hypot(layout.ghosts[i]!.x, layout.ghosts[i]!.y, layout.ghosts[i]!.z);
    const lone = sky.ghosts!.map((g, i) => ({ g, i })).filter(({ g }) => g.by.length === 1);
    const known = sky.ghosts!.map((g, i) => ({ g, i })).filter(({ g }) => g.by.length >= 6);
    expect(lone.length).toBeGreaterThan(10);
    expect(known.length).toBeGreaterThan(5);
    const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length;
    expect(mean(lone.map(({ i }) => radius(i)))).toBeGreaterThan(
      mean(known.map(({ i }) => radius(i))),
    );
  });

  it("hashes to [0, 1) and differs by salt", () => {
    const h = hash01("abc123def456", 3);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(1);
    expect(hash01("abc123def456", 5)).not.toBe(h);
  });
});

/** A 2D context that records what was asked of it and draws nothing. */
function recordingContext() {
  const calls: string[] = [];
  const noop = (name: string) => () => void calls.push(name);
  const ctx = {
    calls,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    globalAlpha: 1,
    save: noop("save"),
    restore: noop("restore"),
    fillRect: noop("fillRect"),
    beginPath: noop("beginPath"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    stroke: noop("stroke"),
    arc: noop("arc"),
    fill: noop("fill"),
    translate: noop("translate"),
    scale: noop("scale"),
    drawImage: noop("drawImage"),
  };
  return ctx as unknown as CanvasRenderingContext2D & { calls: string[] };
}

describe("sky drawing", () => {
  it("projects the origin to the centre and scales with zoom", () => {
    const p = projectPoint({ x: 0, y: 0, z: 0 }, DEFAULT_CAMERA, 600);
    expect(p.x).toBeCloseTo(300);
    expect(p.y).toBeCloseTo(300);
    const near = projectPoint({ x: 0, y: 0, z: -0.4 }, DEFAULT_CAMERA, 600);
    const far = projectPoint({ x: 0, y: 0, z: 0.4 }, DEFAULT_CAMERA, 600);
    expect(near.f).toBeGreaterThan(far.f);
  });

  it("draws every hub and ghost once and returns where they landed", () => {
    const ctx = recordingContext();
    const frame = drawSky(ctx, 600, sky, layoutSky(sky), DEFAULT_CAMERA, null, palette, NO_MARKS);
    expect(frame.hubs).toHaveLength(sky.hubs.length);
    expect(frame.ghosts).toHaveLength(sky.ghosts!.length);
    // Each ghost is one arc; each hub without a prepared mark is a disc plus a highlight.
    expect(ctx.calls.filter((c) => c === "arc").length).toBe(
      sky.ghosts!.length + sky.hubs.length * 2,
    );
    expect(ctx.calls.filter((c) => c === "lineTo").length).toBe(
      sky.ghostEdgesDrawn! + sky.hubEdges.length,
    );
  });

  it("picks the hub under the pointer and nothing far from any point", () => {
    const ctx = recordingContext();
    const frame = drawSky(ctx, 600, sky, layoutSky(sky), DEFAULT_CAMERA, null, palette, NO_MARKS);
    const h = frame.hubs[3]!;
    expect(pickSky(frame, h.x, h.y)).toEqual({ kind: "hub", index: 3 });
    expect(pickSky(frame, -100, -100)).toBeNull();
  });

  it("draws a focused hub with a ring", () => {
    const ctx = recordingContext();
    drawSky(
      ctx,
      600,
      sky,
      layoutSky(sky),
      DEFAULT_CAMERA,
      { kind: "hub", index: 0 },
      palette,
      NO_MARKS,
    );
    const unfocused = recordingContext();
    drawSky(unfocused, 600, sky, layoutSky(sky), DEFAULT_CAMERA, null, palette, NO_MARKS);
    expect(ctx.calls.filter((c) => c === "arc").length).toBe(
      unfocused.calls.filter((c) => c === "arc").length + 1,
    );
  });
});

describe("SkyCanvas", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount(fetchBody: unknown = sky, status = 200) {
    // jsdom has no 2D context; the component must tolerate that and still render its readout.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: status === 200,
        status,
        json: () => Promise.resolve(fetchBody),
      }),
    );
    return render(<SkyCanvas hubs={hubs} />);
  }

  it("renders the readout from the hubs alone, then reports the never-answered set after the fetch", async () => {
    const { container } = mount();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      `${hubs.hubs.length} answering nodes`,
    );
    const readout = screen.getByRole("status");
    expect(readout.textContent).toContain("most advertised");
    expect(readout.textContent).toContain(`${hubs.edgesTotal.toLocaleString("en-US")}`);
    await waitFor(() =>
      expect(container.querySelector("[data-ghosts]")!.textContent).toContain(
        "not answering · 300",
      ),
    );
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      "300 advertised addresses",
    );
  });

  it("draws nothing until the full sky arrives, so the first second is not a different picture", async () => {
    const { container } = mount();
    expect(container.querySelector(".net-sky-wait")).not.toBeNull();
    await waitFor(() => expect(container.querySelector(".net-sky-wait")).toBeNull());
  });

  it("falls back to the hubs alone when the sky cannot be read, and stops waiting", async () => {
    const { container } = mount({}, 503);
    await waitFor(() => expect(container.querySelector(".net-sky-wait")).toBeNull());
    expect(container.querySelector("[data-ghosts]")!.textContent).toContain("could not be read");
  });

  it("pins a hub from the list, shows its facts, and releases on Escape", async () => {
    const { container } = mount();
    const first = screen.getAllByRole("button", { name: /^Pin / })[0]!;
    const id = first.getAttribute("aria-label")!.match(/node ([0-9a-f]{12})/)![1]!;
    fireEvent.click(first);
    const readout = screen.getByRole("status");
    expect(readout.textContent).toContain(id);
    expect(readout.textContent).toContain("advertised by");
    expect(readout.textContent).toContain("Esc");
    fireEvent.keyDown(container.firstElementChild!, { key: "Escape" });
    expect(readout.textContent).toContain("most advertised");
  });

  it("says the never-answered set could not be read rather than drawing none", async () => {
    const { container } = mount({ error: "down" }, 503);
    await waitFor(() =>
      expect(container.querySelector("[data-ghosts]")!.textContent).toContain("could not be read"),
    );
    expect(container.innerHTML).not.toMatch(/\sstyle=/);
    expect(container.innerHTML).not.toMatch(/\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});
