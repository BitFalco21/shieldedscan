import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";

/**
 * A local stand-in for the Hugging Face Hub's two public endpoints the importer reads (a
 * revision's commit, and a file at a commit), serving a release directory. `tamper` corrupts one
 * file's first byte on the wire, to prove a bad download is refused.
 */

export interface Hub {
  endpoint: string;
  requests: string[];
  close: () => Promise<void>;
}

export async function serveRelease(opts: {
  dir: string;
  repo: string;
  commit: string;
  tamper?: string;
  /** Where to listen: loopback unless a container must reach it (`0.0.0.0`). */
  host?: string;
}): Promise<Hub> {
  const requests: string[] = [];
  const revisionPath = `/api/datasets/${opts.repo}/revision/main`;
  const filePrefix = `/datasets/${opts.repo}/resolve/${opts.commit}/`;
  const server: Server = createServer((req, res) => {
    const url = decodeURIComponent(req.url ?? "");
    requests.push(url);
    if (url === revisionPath) {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ sha: opts.commit }));
      return;
    }
    const path = url.startsWith(filePrefix) ? url.slice(filePrefix.length) : null;
    const file = path === null ? null : join(opts.dir, path);
    if (file === null || path!.includes("..") || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-length": statSync(file).size });
    if (path === opts.tamper) {
      let first = true;
      createReadStream(file)
        .on("data", (chunk) => {
          const b = Buffer.from(chunk as Buffer);
          if (first) b[0] = b[0]! ^ 0xff;
          first = false;
          res.write(b);
        })
        .on("end", () => res.end());
      return;
    }
    createReadStream(file).pipe(res);
  });
  await new Promise<void>((resolve) => server.listen(0, opts.host ?? "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    endpoint: `http://127.0.0.1:${port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
