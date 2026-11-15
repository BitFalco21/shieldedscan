import { Resolver } from "node:dns/promises";

/**
 * A DNS seeder answers at its own nameservers, so it is asked there directly. A public recursive
 * resolver would serve a cached answer after the seeder had died, for as long as its TTL allowed.
 */

export interface SeederObservation {
  /** The name actually asked: a seeder can be a CNAME to a name its nameserver serves. */
  asked: string;
  /** The seeder's delegated nameservers, as the public DNS names them. */
  nameservers: string[];
  /** One entry per nameserver address asked. */
  answers: {
    ns: string;
    ip: string;
    a: number | null;
    aaaa: number | null;
    error?: string;
    ms: number;
  }[];
  error?: string;
}

const TIMEOUT_MS = 5_000;
/** A seeder observation stops asking after this long, well inside its five-minute slot. */
const DEADLINE_MS = 90_000;

async function count(r: Resolver, name: string, type: "A" | "AAAA"): Promise<number> {
  try {
    return (type === "A" ? await r.resolve4(name) : await r.resolve6(name)).length;
  } catch (err) {
    // An empty answer is a measurement (no addresses of that family), not a failure.
    const code = (err as { code?: string }).code;
    if (code === "ENODATA" || code === "ENOTFOUND") return 0;
    throw err;
  }
}

export async function observeSeeder(name: string): Promise<SeederObservation> {
  const deadline = Date.now() + DEADLINE_MS;
  const system = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
  // dnsseed.z.cash is a CNAME; its nameserver answers only for the target and refuses the alias.
  let asked = name;
  try {
    asked = (await system.resolveCname(name))[0] ?? name;
  } catch {
    // No CNAME: ask the name itself.
  }
  let nameservers: string[];
  try {
    nameservers = (await system.resolveNs(asked)).sort();
  } catch (err) {
    return {
      asked,
      nameservers: [],
      answers: [],
      error: `ns: ${(err as { code?: string }).code ?? String(err)}`,
    };
  }
  const answers: SeederObservation["answers"] = [];
  for (const ns of nameservers) {
    let ips: string[];
    try {
      ips = await system.resolve4(ns);
    } catch (err) {
      answers.push({
        ns,
        ip: "",
        a: null,
        aaaa: null,
        error: `ns address: ${(err as Error).message}`,
        ms: 0,
      });
      continue;
    }
    for (const ip of ips.slice(0, 2)) {
      if (Date.now() > deadline) {
        answers.push({ ns, ip, a: null, aaaa: null, error: "not asked: deadline", ms: 0 });
        continue;
      }
      const started = Date.now();
      const direct = new Resolver({ timeout: TIMEOUT_MS, tries: 2 });
      direct.setServers([ip]);
      try {
        // One query at a time: one seeder refused a second query sent in parallel.
        const a = await count(direct, asked, "A");
        const aaaa = await count(direct, asked, "AAAA");
        answers.push({ ns, ip, a, aaaa, ms: Date.now() - started });
      } catch (err) {
        answers.push({
          ns,
          ip,
          a: null,
          aaaa: null,
          error: (err as { code?: string }).code ?? String(err),
          ms: Date.now() - started,
        });
      }
    }
  }
  return { asked, nameservers, answers };
}
