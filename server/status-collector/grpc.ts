import { connect, constants } from "node:http2";

/**
 * Two unary calls to a light-wallet server (lightwalletd or Zaino), over plain HTTP/2 with gRPC
 * framing: no gRPC library, because both requests are empty messages and both answers are small
 * protobufs read below. HTTP 200 with a non-zero `grpc-status` is a failure, as gRPC defines it.
 */

const SERVICE = "/cash.z.wallet.sdk.rpc.CompactTxStreamer";

/** An empty request message in gRPC's length-prefixed framing: no compression, length 0. */
const EMPTY_FRAME = Buffer.from([0, 0, 0, 0, 0]);
/** Both answers are a few hundred bytes; anything past this is not a light-wallet server. */
const MAX_BODY_BYTES = 1 << 20;

export interface GrpcResult {
  ok: boolean;
  /** The message body, unframed. */
  body?: Buffer;
  error?: string;
  ms: number;
}

/** One unary call with an empty request; never throws. */
export function grpcUnary(
  host: string,
  port: number,
  method: string,
  timeoutMs = 10_000,
): Promise<GrpcResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: Omit<GrpcResult, "ms">) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      session.close();
      resolve({ ...r, ms: Date.now() - started });
    };
    const session = connect(`https://${host}:${port}`, { servername: host });
    const timer = setTimeout(() => {
      session.destroy();
      done({ ok: false, error: "timeout" });
    }, timeoutMs);
    session.on("error", (err) => done({ ok: false, error: `connect: ${err.message}` }));
    const req = session.request({
      [constants.HTTP2_HEADER_METHOD]: "POST",
      [constants.HTTP2_HEADER_PATH]: `${SERVICE}/${method}`,
      "content-type": "application/grpc",
      te: "trailers",
    });
    const chunks: Buffer[] = [];
    let status = 0;
    let grpcStatus: string | undefined;
    req.on("response", (headers) => {
      status = Number(headers[constants.HTTP2_HEADER_STATUS]);
      const g = headers["grpc-status"];
      if (g !== undefined) grpcStatus = String(g);
    });
    req.on("trailers", (trailers) => {
      const g = trailers["grpc-status"];
      if (g !== undefined) grpcStatus = String(g);
    });
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        req.close();
        session.destroy();
        done({ ok: false, error: "oversized answer" });
        return;
      }
      chunks.push(c);
    });
    req.on("error", (err) => done({ ok: false, error: `request: ${err.message}` }));
    req.on("end", () => {
      if (status !== 200) return done({ ok: false, error: `http ${status}` });
      if (grpcStatus !== "0")
        return done({ ok: false, error: `grpc-status ${grpcStatus ?? "missing"}` });
      const framed = Buffer.concat(chunks);
      const body = unframe(framed);
      if (body === null) return done({ ok: false, error: "bad frame" });
      done({ ok: true, body });
    });
    req.end(EMPTY_FRAME);
  });
}

/** The first message of a gRPC response body, or null when the framing is wrong. */
export function unframe(framed: Buffer): Buffer | null {
  if (framed.length < 5 || framed[0] !== 0) return null;
  const length = framed.readUInt32BE(1);
  if (framed.length < 5 + length) return null;
  return framed.subarray(5, 5 + length);
}
