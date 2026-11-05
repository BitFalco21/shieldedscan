import { NU7_HEIGHT } from "@/domain";
import { formatCount } from "@/lib/format";
import { HEARTBEAT_NOW_X, type HeartbeatModel } from "./nu7-countdown";

/** The site's tokens, read from the page so the trace follows the theme. */
export interface TracePalette {
  green: string;
  greenDim: string;
  greenFaint: string;
  warn: string;
  inkFaint: string;
  font: string;
}

/** The trace's height in CSS pixels; the width follows the container. */
export const TRACE_HEIGHT = 150;

/**
 * Draws the heartbeat: a flat baseline with one spike per real block at its real time, a dashed
 * "now", faint ticks where the next blocks would land at the target spacing, and the projected
 * activation in amber. `dpr` scales every stroke so it stays crisp on dense screens.
 */
export function drawHeartbeat(
  g: CanvasRenderingContext2D,
  width: number,
  height: number,
  dpr: number,
  model: HeartbeatModel,
  now: number,
  windowSeconds: number,
  palette: TracePalette,
): void {
  const mid = height * 0.62;
  const nowX = width * HEARTBEAT_NOW_X;
  const xOf = (t: number) => nowX + ((t - now) / windowSeconds) * nowX;
  const top = 22 * dpr;
  g.clearRect(0, 0, width, height);
  g.font = `${11 * dpr}px ${palette.font}`;

  // Five-minute grid, faint.
  g.globalAlpha = 0.35;
  g.strokeStyle = palette.greenFaint;
  g.lineWidth = dpr;
  for (let m = 0; m <= windowSeconds / 60; m += 5) {
    const x = Math.round(xOf(now - m * 60));
    g.beginPath();
    g.moveTo(x, top);
    g.lineTo(x, height);
    g.stroke();
  }

  // The future, a shade lighter, behind a dashed "now".
  g.globalAlpha = 0.04;
  g.fillStyle = palette.green;
  g.fillRect(nowX, 0, width - nowX, height);
  g.globalAlpha = 1;
  g.setLineDash([3 * dpr, 4 * dpr]);
  g.strokeStyle = palette.greenFaint;
  g.beginPath();
  g.moveTo(nowX, top);
  g.lineTo(nowX, height);
  g.stroke();

  // Where the next blocks would land at the target.
  g.setLineDash([2 * dpr, 3 * dpr]);
  g.strokeStyle = model.step === 25 ? palette.greenDim : palette.greenFaint;
  for (const t of model.projected) {
    const x = xOf(t);
    g.beginPath();
    g.moveTo(x, mid - 10 * dpr);
    g.lineTo(x, mid + 4 * dpr);
    g.stroke();
  }
  g.setLineDash([]);

  if (model.marker !== null) {
    const x = xOf(model.marker);
    g.strokeStyle = palette.warn;
    g.lineWidth = 2 * dpr;
    g.beginPath();
    g.moveTo(x, mid - 46 * dpr);
    g.lineTo(x, mid + 10 * dpr);
    g.stroke();
    g.fillStyle = palette.warn;
    g.textAlign = "center";
    g.fillText("NU7", x, mid - 52 * dpr);
  } else if (model.blocksLeft > 0) {
    g.fillStyle = palette.inkFaint;
    g.textAlign = "right";
    g.fillText(
      `${formatCount(model.blocksLeft)} blocks to NU7 ▸`,
      width - 10 * dpr,
      mid + 32 * dpr,
    );
  }

  // The trace itself, oldest first; the activation block, once real, is the one amber spike.
  const spikes = [...model.spikes].sort((a, b) => a.t - b.t);
  g.lineWidth = 1.6 * dpr;
  g.strokeStyle = palette.green;
  g.shadowColor = palette.green;
  g.shadowBlur = 6 * dpr;
  g.beginPath();
  g.moveTo(0, mid);
  for (const { t } of spikes) spike(g, xOf(t), mid, 38 * dpr, dpr);
  g.lineTo(nowX, mid);
  g.stroke();

  const activation = spikes.find((s) => s.height === NU7_HEIGHT);
  if (activation) {
    g.strokeStyle = palette.warn;
    g.shadowColor = palette.warn;
    g.shadowBlur = 12 * dpr;
    g.lineWidth = 2.4 * dpr;
    g.beginPath();
    const x = xOf(activation.t);
    g.moveTo(x - 8 * dpr, mid);
    spike(g, x, mid, 70 * dpr, dpr);
    g.stroke();
  }
  g.shadowBlur = 0;
  g.textAlign = "start";
}

/**
 * The classes a palette probe carries, in `TracePalette` order. A canvas cannot read Tailwind
 * classes, so each canvas renders hidden spans with these and reads their computed colour.
 */
export const PROBE_CLASSES = [
  "text-green",
  "text-green-dim",
  "text-green-faint",
  "text-warn",
  "text-ink-faint",
] as const;

export function readPalette(probe: HTMLElement): TracePalette {
  const colour = (i: number) => {
    const el = probe.children[i];
    return el ? getComputedStyle(el).color : "transparent";
  };
  return {
    green: colour(0),
    greenDim: colour(1),
    greenFaint: colour(2),
    warn: colour(3),
    inkFaint: colour(4),
    font: getComputedStyle(probe.parentElement ?? probe).fontFamily || "monospace",
  };
}

/** One QRS-like beat centred on `x`. */
function spike(g: CanvasRenderingContext2D, x: number, mid: number, amp: number, dpr: number) {
  g.lineTo(x - 6 * dpr, mid);
  g.lineTo(x - 3 * dpr, mid + 8 * dpr);
  g.lineTo(x, mid - amp);
  g.lineTo(x + 3 * dpr, mid + 12 * dpr);
  g.lineTo(x + 7 * dpr, mid);
}
