import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Testing Library auto-registers cleanup only with `test.globals: true`. This project uses
// explicit `vitest` imports, so without this hook DOM leaks between tests in a file.
afterEach(() => {
  cleanup();
});

// `useRouter` throws outside a mounted app router, and every unavailable panel carries a retry
// button that calls it. A file that mocks `next/navigation` itself replaces this.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => testRouter,
}));

const testRouter = {
  refresh: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  prefetch: vi.fn(),
};
