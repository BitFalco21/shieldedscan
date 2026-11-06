import { tagTransient } from "@/lib/transient-upstream";
import type { ExplorerDataSource } from "./source";

type Method = (...args: unknown[]) => Promise<unknown>;

/**
 * The source with every method wrapped by `around`. Every port method is async, so a wrapper
 * sees each call's arguments and its promise.
 */
function wrapMethods(
  source: ExplorerDataSource,
  around: (name: string, call: () => Promise<unknown>) => Promise<unknown>,
): ExplorerDataSource {
  return new Proxy(source, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function" || typeof property !== "string") return value;
      const method = value as Method;
      return (...args: unknown[]) => around(property, () => method.apply(target, args));
    },
  });
}

/**
 * Every transient failure leaves the source with `UPSTREAM_UNAVAILABLE_DIGEST`, so a page that
 * lets one escape shows the error boundary's "didn't load" state rather than its crash copy.
 */
export function tagTransientFailures(source: ExplorerDataSource): ExplorerDataSource {
  return wrapMethods(source, (_name, call) =>
    call().catch((error: unknown) => {
      throw tagTransient(error);
    }),
  );
}

/** The request header naming the methods to fail, comma-separated. */
export const FAULT_HEADER = "x-e2e-fault";

/**
 * Fault injection for the end-to-end suites: a method named in the `x-e2e-fault` request header
 * fails as a timeout would. Wired only over the fixture source and only with `E2E_FAULTS=1`
 * (`index.ts`), and a public build refuses fixtures, so production never reaches it.
 */
export function injectFaults(
  source: ExplorerDataSource,
  readFaults: () => Promise<readonly string[]>,
): ExplorerDataSource {
  return wrapMethods(source, async (name, call) => {
    if ((await readFaults()).includes(name)) {
      // Named as `AbortSignal.timeout()` names its error, so it is classified as one.
      throw Object.assign(new Error(`injected fault in ${name}`), { name: "TimeoutError" });
    }
    return call();
  });
}
