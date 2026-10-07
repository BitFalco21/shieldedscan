/**
 * Reading a third-party response with a size ceiling. Every poller trusts its upstream's TLS and
 * host, but a compromised or misbehaving upstream must not be able to exhaust this process's
 * memory with one enormous body. The default is far above any legitimate response.
 */
export const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;

export class BodyTooLargeError extends Error {
  constructor(maxBytes: number) {
    super(`response body exceeds ${maxBytes} bytes`);
  }
}

export async function readTextCapped(
  res: Response,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<string> {
  const declared = Number(res.headers?.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new BodyTooLargeError(maxBytes);
  }
  // Test doubles without a stream: nothing to bound, read as given.
  if (!res.body) return typeof res.text === "function" ? res.text() : "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new BodyTooLargeError(maxBytes);
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function readJsonCapped(
  res: Response,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  if (!res.body && typeof res.json === "function") return res.json();
  return JSON.parse(await readTextCapped(res, maxBytes));
}
