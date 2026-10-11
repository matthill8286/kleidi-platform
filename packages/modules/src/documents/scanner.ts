import { connect } from "node:net";
import type { Readable } from "node:stream";

export type ScanResult = { clean: true } | { clean: false; signature: string };

export type Scanner = { scan(file: Readable): Promise<ScanResult> };

/**
 * Streams a file to clamd with the INSTREAM command: length-prefixed chunks, then a zero
 * length. clamd answers "stream: OK" or "stream: <signature> FOUND".
 */
export function createClamdScanner(options: {
  host: string;
  port: number;
  timeoutMs?: number;
}): Scanner {
  return {
    scan: (file) =>
      new Promise<ScanResult>((resolve, reject) => {
        const socket = connect(options.port, options.host);
        socket.setTimeout(options.timeoutMs ?? 60_000, () =>
          socket.destroy(new Error("clamd timed out")),
        );
        let reply = "";
        socket.on("data", (d) => (reply += d.toString()));
        socket.on("error", reject);
        socket.on("end", () => {
          const text = reply.replace(/\0/g, "").trim();
          if (/: OK$/.test(text)) return resolve({ clean: true });
          const found = /: (.+) FOUND$/.exec(text);
          if (found) return resolve({ clean: false, signature: found[1]! });
          reject(new Error(`clamd: ${text || "no answer"}`));
        });
        socket.on("connect", async () => {
          try {
            socket.write("zINSTREAM\0");
            for await (const chunk of file) {
              const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
              const size = Buffer.alloc(4);
              size.writeUInt32BE(data.length);
              socket.write(size);
              socket.write(data);
            }
            socket.write(Buffer.alloc(4));
          } catch (error) {
            socket.destroy(error as Error);
          }
        });
      }),
  };
}
