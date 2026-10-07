import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-registers cleanup only with `test.globals: true`. This project uses
// explicit `vitest` imports, so without this hook DOM leaks between tests in a file.
afterEach(() => {
  cleanup();
});
