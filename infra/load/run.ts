// Load test: lawyers working through their cases at once.
// Usage: node infra/load/run.ts <base-url> [virtual-users] [seconds]
// The target needs RATE_LIMIT_PER_MINUTE raised, since every request comes from one address.
import { createHmac, randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:4300";
const users = Number(process.argv[3] ?? 50);
const seconds = Number(process.argv[4] ?? 60);
const PASSWORD = "load-test-password-123";

/** RFC 6238 code from a base32 secret, as an authenticator app computes it. */
function totp(secret: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = secret
    .replace(/=+$/, "")
    .toUpperCase()
    .split("")
    .map((c) => alphabet.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  return String((hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

/** A signed-in lawyer with their own firm, like a browser with cookies. */
async function lawyer(n: number) {
  let cookie = "";
  let firm = "";
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        origin: base,
        ...(cookie ? { cookie } : {}),
        ...(firm ? { "x-kleidi-firm": firm } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    for (const c of res.headers.getSetCookie()) {
      const pair = c.split(";")[0]!;
      const name = pair.split("=")[0]!;
      cookie = [...cookie.split("; ").filter((x) => x && !x.startsWith(`${name}=`)), pair].join(
        "; ",
      );
    }
    // Sign-up and two-factor are rate limited per address, as they should be: wait and retry.
    if (res.status === 429 && path.startsWith("/api/auth/")) {
      const wait = Number(res.headers.get("x-retry-after") ?? res.headers.get("retry-after") ?? 5);
      await new Promise((r) => setTimeout(r, (wait + 1) * 1000));
      return call(method, path, body);
    }
    return res;
  };
  const email = `load.${n}.${randomUUID().slice(0, 8)}@example.test`;
  await call("POST", "/api/auth/sign-up/email", {
    name: `Load Lawyer ${n}`,
    email,
    password: PASSWORD,
  });
  const enable = await (
    await call("POST", "/api/auth/two-factor/enable", { password: PASSWORD })
  ).json();
  const secret = new URL(enable.totpURI).searchParams.get("secret")!;
  await call("POST", "/api/auth/two-factor/verify-totp", { code: totp(secret) });
  firm = (await (await call("POST", "/api/v1/firms", { name: `Load Firm ${n}` })).json()).id;
  const cases: string[] = [];
  for (let i = 0; i < 5; i++) {
    const res = await call("POST", "/api/v1/cases", {
      propertyAddress: `${i + 1} Load Street, Limassol`,
      propertyType: "resale",
      parties: [{ role: "buyer", fullName: "Load Buyer" }],
    });
    cases.push((await res.json()).id);
  }
  return { call, cases };
}

type Sample = { name: string; ms: number; status: number };
const samples: Sample[] = [];

// A lawyer's day: mostly reading cases and checklists, sometimes opening a new case.
async function session(l: Awaited<ReturnType<typeof lawyer>>, until: number) {
  const pick = <T>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
  const steps: [number, string, () => Promise<Response>][] = [
    [30, "list cases", () => l.call("GET", "/api/v1/cases?limit=25")],
    [20, "open case", () => l.call("GET", `/api/v1/cases/${pick(l.cases)}`)],
    [20, "checklist", () => l.call("GET", `/api/v1/cases/${pick(l.cases)}/documents`)],
    [15, "activity", () => l.call("GET", `/api/v1/cases/${pick(l.cases)}/activity`)],
    [10, "my deadlines", () => l.call("GET", "/api/v1/deadlines?mine=true")],
    [
      5,
      "open new case",
      () =>
        l.call("POST", "/api/v1/cases", {
          propertyAddress: "99 Load Street, Paphos",
          propertyType: "land",
          parties: [{ role: "buyer", fullName: "Another Buyer" }],
        }),
    ],
  ];
  while (Date.now() < until) {
    let roll = Math.random() * 100;
    const step = steps.find(([weight]) => (roll -= weight) < 0) ?? steps[0]!;
    const start = performance.now();
    const res = await step[2]();
    await res.arrayBuffer();
    samples.push({ name: step[1], ms: performance.now() - start, status: res.status });
  }
}

const pct = (xs: number[], p: number) =>
  xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))] ?? 0;

// Five browser tabs per lawyer, so fewer accounts need signing up through the rate limits.
const TABS = 5;
const accounts = Math.ceil(users / TABS);
console.log(`Preparing ${accounts} lawyers (${users} sessions) against ${base}...`);
const lawyers = [];
for (let i = 0; i < accounts; i++) lawyers.push(await lawyer(i));
console.log(`Running for ${seconds} seconds...`);
const until = Date.now() + seconds * 1000;
await Promise.all(Array.from({ length: users }, (_, i) => session(lawyers[i % accounts]!, until)));

const rows = [...new Set(samples.map((s) => s.name)), "all"].map((name) => {
  const set = samples.filter((s) => name === "all" || s.name === name);
  const ms = set.map((s) => s.ms).sort((a, b) => a - b);
  const errors = set.filter((s) => s.status >= 400).length;
  return {
    request: name,
    count: set.length,
    "p50 ms": Math.round(pct(ms, 50)),
    "p95 ms": Math.round(pct(ms, 95)),
    "p99 ms": Math.round(pct(ms, 99)),
    errors,
  };
});
console.table(rows);
console.log(`Throughput: ${Math.round(samples.length / seconds)} requests per second`);
