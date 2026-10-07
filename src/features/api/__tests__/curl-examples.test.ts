import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { API_CODE_EXAMPLES, API_GROUPS, curlCommand } from "@/api-catalogue";

/**
 * The copyable commands are checked by a shell, not by a regex: a placeholder such as
 * `<heightOrHash>` is a bash redirection and a syntax error, and a regex banning `<` would miss
 * the next metacharacter. `bash -n` parses the real string with the whole grammar.
 *
 * `-n` is syntax-check only: bash parses and runs nothing, so this is safe as a unit test.
 */
const ALL_ENDPOINTS = API_GROUPS.flatMap((group) => group.endpoints);

function shellParses(command: string): { ok: true } | { ok: false; error: string } {
  try {
    execFileSync("bash", ["-n"], { input: command, stdio: ["pipe", "pipe", "pipe"] });
    return { ok: true };
  } catch (error) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() ?? String(error);
    return { ok: false, error: stderr.trim() };
  }
}

describe("the documented curl commands", () => {
  it("has an endpoint carrying a path parameter, or this suite proves nothing", () => {
    // A sweep over a catalogue with no parameterised path would pass without testing the
    // interesting case.
    expect(ALL_ENDPOINTS.some((e) => e.path.includes("{"))).toBe(true);
  });

  for (const endpoint of ALL_ENDPOINTS) {
    it(`${endpoint.method} ${endpoint.path} copies as a command a shell can run`, () => {
      const command = curlCommand(endpoint);
      const result = shellParses(command);
      expect(result.ok, `${command}\n${result.ok ? "" : result.error}`).toBe(true);
    });
  }

  it("substitutes the pinned example rather than leaving a placeholder", () => {
    // Runnable is not enough: a quoted '<heightOrHash>' parses fine and 404s. Where the
    // catalogue pins an example — and it pins one for every path parameter, chosen so a first
    // request returns data — the command must use it.
    for (const endpoint of ALL_ENDPOINTS) {
      const command = curlCommand(endpoint);
      for (const param of endpoint.params) {
        if (param.kind !== "path" || param.example === undefined) continue;
        expect(command, `${endpoint.id} dropped its ${param.name} example`).toContain(
          param.example,
        );
        expect(command, `${endpoint.id} still carries a placeholder`).not.toContain(
          `{${param.name}}`,
        );
      }
    }
  });

  it("carries every required query parameter, so a copied command is not a 400", () => {
    // `from` and `to` are required on the windowed analytics: a command naming only the path
    // parses, runs, and answers "from is required".
    for (const endpoint of ALL_ENDPOINTS) {
      const command = curlCommand(endpoint);
      for (const param of endpoint.params) {
        if (param.kind !== "query" || !param.required) continue;
        expect(
          param.example,
          `${endpoint.id}: required ${param.name} has no example`,
        ).toBeDefined();
        expect(command, `${endpoint.id} dropped required ${param.name}`).toContain(
          `${param.name}=`,
        );
      }
    }
  });

  it("ships copyable code examples a shell can parse, for the cURL block", () => {
    // `API_CODE_EXAMPLES` is a second, hand-maintained source of commands. The JavaScript and
    // Python blocks are not shell, so only the cURL one is parsed — but it is parsed for the
    // same reason: it is offered to be pasted.
    const curl = API_CODE_EXAMPLES.find((e) => e.language === "cURL");
    expect(curl, "the cURL example block must exist").toBeTruthy();
    const result = shellParses(curl!.code);
    expect(result.ok, result.ok ? "" : result.error).toBe(true);
  });
});
