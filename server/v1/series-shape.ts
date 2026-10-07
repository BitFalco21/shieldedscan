import { ParamError } from "./params";

/**
 * Ranking and field selection for the analytics answers: `sort`, `order`, `top` and `fields`,
 * applied to the one list an analytics answer carries (`data.buckets`, `data.points` or
 * `data.groups`).
 *
 * A year at daily grain is ~150–175 KB, and ranking 366 periods is exactly the sorting a model
 * gets wrong. Applied in memory to the answer the endpoint already built, after its cache, so a
 * ranked view costs no query of its own.
 *
 * Rules shared with the agent's ranking (`rankBuckets`):
 *  - a period whose measure is null is dropped and counted (`unmeasured`), never ranked as zero;
 *  - `tiedAtTop` above 1 means there is no single answer, and a caller must not name one;
 *  - the tiebreak is the period's own position, so the same question gives the same rows twice;
 *  - `top` without `sort` is a 400, because "the first N periods" is what the list already is.
 *
 * `unknowns` paths name list positions (`data.points.3.avgDifficulty`), so they are renumbered to
 * follow their rows.
 */

export const SHAPE_PARAMS = ["sort", "order", "top", "fields"] as const;

export interface Shape {
  sort: string | null;
  order: "asc" | "desc";
  top: number | null;
  fields: string[] | null;
}

const PATH = /^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)*$/;

/** Null when none of the four is present: the answer is returned exactly as built. */
export function parseShape(q: Record<string, string>): Shape | null {
  const sort = q.sort?.trim() || null;
  const fieldsRaw = q.fields?.trim() || null;
  if (sort === null && fieldsRaw === null && q.top === undefined && q.order === undefined) {
    return null;
  }
  if (sort !== null && !PATH.test(sort)) {
    throw new ParamError(
      "invalid_parameter",
      "sort is a dotted field path, e.g. transactions.total",
    );
  }
  if ((q.top !== undefined || q.order !== undefined) && sort === null) {
    throw new ParamError("invalid_parameter", "top and order need sort: name the field to rank by");
  }
  const order = q.order === undefined ? "desc" : q.order;
  if (order !== "asc" && order !== "desc") {
    throw new ParamError("invalid_parameter", "order must be asc or desc");
  }
  let top: number | null = null;
  if (q.top !== undefined) {
    top = Number(q.top);
    if (!Number.isInteger(top) || top < 1 || top > 100) {
      throw new ParamError("invalid_parameter", "top must be an integer from 1 to 100");
    }
  }
  let fields: string[] | null = null;
  if (fieldsRaw !== null) {
    fields = [...new Set(fieldsRaw.split(",").map((f) => f.trim()))].filter(Boolean);
    const bad = fields.filter((f) => !PATH.test(f));
    if (fields.length === 0 || bad.length > 0) {
      throw new ParamError("invalid_parameter", "fields is a comma-separated list of field paths");
    }
  }
  return { sort, order, top, fields };
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

function at(o: unknown, path: string): unknown {
  let cur: unknown = o;
  for (const part of path.split(".")) {
    if (!isObj(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

/** Every path to a number (or a null that stands where a number may be) in one element. */
function leafPaths(o: unknown, prefix = "", depth = 0): string[] {
  if (!isObj(o) || depth > 5) return [];
  return Object.entries(o).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number" || v === null) return [path];
    return leafPaths(v, path, depth + 1);
  });
}

/** Every path, leaf or branch — what `fields` may name. */
function allPaths(o: unknown, prefix = "", depth = 0): string[] {
  if (!isObj(o) || depth > 5) return [];
  return Object.entries(o).flatMap(([k, v]) => {
    const path = prefix ? `${prefix}.${k}` : k;
    return [path, ...allPaths(v, path, depth + 1)];
  });
}

function pick(o: Obj, paths: readonly string[]): Obj {
  const out: Obj = {};
  for (const path of paths) {
    const value = at(o, path);
    if (value === undefined) continue;
    const parts = path.split(".");
    let cur = out;
    for (const part of parts.slice(0, -1)) {
      cur[part] = isObj(cur[part]) ? cur[part] : {};
      cur = cur[part] as Obj;
    }
    cur[parts.at(-1)!] = value;
  }
  return out;
}

const LIST_KEYS = ["buckets", "points", "groups"] as const;
/** The field that names a row, always kept by `fields`. */
const LABEL_KEYS = ["periodStart", "key"];

/**
 * The answer with its list ranked and/or trimmed. Throws `ParamError` for a path the list does
 * not have, naming the paths it does — a self-documenting 400 rather than an empty ranking.
 */
export function applyShape<T extends { data?: unknown; unknowns?: unknown }>(
  body: T,
  shape: Shape | null,
): T {
  if (shape === null || !isObj(body.data)) return body;
  const data = body.data;
  const listKey = LIST_KEYS.find((k) => Array.isArray(data[k]));
  if (listKey === undefined) {
    throw new ParamError("invalid_parameter", "this answer has no list of periods to rank or trim");
  }
  const rows = (data[listKey] as unknown[]).filter(isObj);
  let order = rows.map((_, i) => i);
  let ranking: Obj | null = null;

  if (shape.sort !== null) {
    const sortPath = shape.sort;
    const valid = [...new Set(rows.flatMap((r) => leafPaths(r)))];
    if (rows.length > 0 && !valid.includes(sortPath)) {
      throw new ParamError(
        "invalid_parameter",
        `sort: no numeric field ${sortPath} here; one of ${valid.join(", ")}`,
      );
    }
    const measured = order.filter((i) => typeof at(rows[i], sortPath) === "number");
    const sign = shape.order === "asc" ? 1 : -1;
    measured.sort(
      (a, b) =>
        sign * ((at(rows[a], sortPath) as number) - (at(rows[b], sortPath) as number)) || a - b,
    );
    const topValue = measured.length > 0 ? at(rows[measured[0]!], sortPath) : null;
    order = shape.top === null ? measured : measured.slice(0, shape.top);
    ranking = {
      by: sortPath,
      order: shape.order,
      top: shape.top,
      considered: measured.length,
      unmeasured: rows.length - measured.length,
      tiedAtTop:
        topValue === null ? 0 : measured.filter((i) => at(rows[i], sortPath) === topValue).length,
    };
  }

  let shaped = order.map((i) => rows[i]!);
  if (shape.fields !== null) {
    const valid = [...new Set(rows.flatMap((r) => allPaths(r)))];
    const bad = shape.fields.filter((f) => rows.length > 0 && !valid.includes(f));
    if (bad.length > 0) {
      throw new ParamError(
        "invalid_parameter",
        `fields: no field ${bad.join(", ")} here; one of ${valid.join(", ")}`,
      );
    }
    const keep = [...LABEL_KEYS, ...shape.fields];
    shaped = shaped.map((r) => pick(r, keep));
  }

  // Renumber unknowns to follow their rows, and drop those whose row or field is gone.
  const position = new Map(order.map((oldIndex, newIndex) => [oldIndex, newIndex]));
  const prefix = `data.${listKey}.`;
  const unknowns: Obj = {};
  for (const [key, reason] of Object.entries(isObj(body.unknowns) ? body.unknowns : {})) {
    if (!key.startsWith(prefix)) {
      unknowns[key] = reason;
      continue;
    }
    const rest = key.slice(prefix.length);
    const dot = rest.indexOf(".");
    const oldIndex = Number(dot === -1 ? rest : rest.slice(0, dot));
    const field = dot === -1 ? "" : rest.slice(dot + 1);
    const newIndex = position.get(oldIndex);
    if (newIndex === undefined) continue;
    if (
      shape.fields !== null &&
      field !== "" &&
      !shape.fields.some(
        (f) => field === f || field.startsWith(`${f}.`) || f.startsWith(`${field}.`),
      )
    ) {
      continue;
    }
    unknowns[`${prefix}${newIndex}${field ? `.${field}` : ""}`] = reason;
  }

  return {
    ...body,
    data: { ...data, [listKey]: shaped, ...(ranking ? { ranking } : {}) },
    unknowns,
  };
}
