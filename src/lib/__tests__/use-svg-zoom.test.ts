import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { createRef } from "react";
import { useSvgZoom } from "../use-svg-zoom";

/**
 * The zoom arithmetic both maps share. jsdom reports a zero-size box for every element, so
 * the svg ref is given a fake `getBoundingClientRect` that puts the 1000×500 viewBox on a
 * 500×250 pixel frame at the origin — two client pixels per user unit either way.
 */
function mount(kMax = 12) {
  const svgRef = createRef<SVGSVGElement>();
  const boxRef = createRef<HTMLDivElement>();
  (svgRef as { current: unknown }).current = {
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 500, height: 250 }),
  };
  return renderHook(() => useSvgZoom({ svgRef, boxRef, width: 1000, height: 500, kMax }));
}

describe("useSvgZoom", () => {
  it("starts at the identity view and is not dragging", () => {
    const { result } = mount();
    expect(result.current.view).toEqual({ k: 1, tx: 0, ty: 0 });
    expect(result.current.dragging).toBe(false);
  });

  it("zooms about the pointer: the point under the cursor stays under the cursor", () => {
    const { result } = mount();
    // Client (250,125) is the frame's centre → user (500,250).
    act(() => result.current.zoomAt(2, 250, 125));
    const { k, tx, ty } = result.current.view;
    expect(k).toBe(2);
    expect(500 * k + tx).toBe(500);
    expect(250 * k + ty).toBe(250);
  });

  it("never scales below 1 or above kMax", () => {
    const { result } = mount(4);
    act(() => result.current.zoomAt(0.5, 0, 0));
    expect(result.current.view.k).toBe(1);
    act(() => result.current.zoomAt(100, 0, 0));
    expect(result.current.view.k).toBe(4);
  });

  it("keeps the drawing inside the frame when panning at the edge", () => {
    const { result } = mount();
    act(() => result.current.zoomAt(2, 0, 0));
    // Zooming about the top-left corner leaves tx = ty = 0; a drag right/down cannot expose
    // empty space, and a drag past the far edge clamps at (width - width*k).
    const down = {
      pointerId: 1,
      clientX: 10,
      clientY: 10,
      target: {},
      currentTarget: { setPointerCapture: () => {} },
    };
    act(() => result.current.handlers.onPointerDown(asEvent(down)));
    act(() =>
      result.current.handlers.onPointerMove(asEvent({ ...down, clientX: 60, clientY: 60 })),
    );
    expect(result.current.view).toEqual({ k: 2, tx: 0, ty: 0 });
    act(() =>
      result.current.handlers.onPointerMove(asEvent({ ...down, clientX: -5000, clientY: -5000 })),
    );
    expect(result.current.view).toEqual({ k: 2, tx: -1000, ty: -500 });
  });

  it("reports a captured pointer as consumed and an uncaptured one as free", () => {
    const { result } = mount();
    const down = {
      pointerId: 7,
      clientX: 0,
      clientY: 0,
      target: {},
      currentTarget: { setPointerCapture: () => {} },
    };
    let consumed = true;
    act(() => {
      consumed = result.current.handlers.onPointerMove(asEvent({ ...down, pointerId: 99 }));
    });
    expect(consumed).toBe(false);
    act(() => result.current.handlers.onPointerDown(asEvent(down)));
    expect(result.current.dragging).toBe(true);
    act(() => {
      consumed = result.current.handlers.onPointerMove(asEvent({ ...down, clientX: 30 }));
    });
    expect(consumed).toBe(true);
    expect(result.current.moved.current).toBe(true);
    act(() => result.current.handlers.onPointerUp(asEvent(down)));
    expect(result.current.dragging).toBe(false);
  });

  it("leaves a press on a button alone, so the button still sees its click", () => {
    const { result } = mount();
    const button = { closest: (sel: string) => (sel === "button" ? {} : null) };
    let captured = false;
    const e = {
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      target: button,
      currentTarget: { setPointerCapture: () => (captured = true) },
    };
    act(() => result.current.handlers.onPointerDown(asEvent(e)));
    expect(captured).toBe(false);
    expect(result.current.dragging).toBe(false);
  });

  it("reset returns to the identity", () => {
    const { result } = mount();
    act(() => result.current.zoomAt(3, 100, 100));
    act(() => result.current.reset());
    expect(result.current.view).toEqual({ k: 1, tx: 0, ty: 0 });
  });
});

function asEvent(e: {
  pointerId: number;
  clientX: number;
  clientY: number;
  target: object;
  currentTarget: object;
}) {
  const target = "closest" in e.target ? e.target : { closest: () => null };
  return { ...e, target } as unknown as React.PointerEvent<HTMLElement>;
}
