import { describe, expect, it } from "vitest";
import { readJsonCapped, readTextCapped } from "../body-limit";

function streamed(bytes: number, declare = false): Response {
  const chunk = new Uint8Array(1024).fill(97);
  let sent = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= bytes) return controller.close();
      sent += chunk.byteLength;
      controller.enqueue(chunk);
    },
  });
  return new Response(body, declare ? { headers: { "content-length": String(bytes) } } : {});
}

describe("capped body reads", () => {
  it("reads an ordinary body", async () => {
    expect(await readJsonCapped(new Response('{"a":1}'))).toEqual({ a: 1 });
    expect(await readTextCapped(new Response("hello"))).toBe("hello");
  });

  it("refuses a body that grows past the ceiling, without a declared length", async () => {
    await expect(readTextCapped(streamed(64 * 1024), 16 * 1024)).rejects.toThrow(/exceeds/);
  });

  it("refuses a declared length past the ceiling before reading", async () => {
    await expect(readTextCapped(streamed(64 * 1024, true), 16 * 1024)).rejects.toThrow(/exceeds/);
  });
});
