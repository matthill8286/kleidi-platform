// Loads realistic demo cases into Elena Christou's local firm through the API, for showing
// Kleidi to lawyers. Local only. Run with `pnpm demo:data` while `pnpm dev` is running.
import { symmetricDecrypt } from "better-auth/crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { createDb, schema } from "@kleidi/db";
import { createS3Store } from "@kleidi/modules/documents";
import { createAuth } from "@kleidi/modules/identity";
import {
  createNotifierFromEnv,
  type Notifier,
  type OutboundMessage,
} from "@kleidi/modules/notifications";
import { buildApp } from "../src/app.ts";
import { loadEnv } from "../src/env.ts";
import { client, totp } from "../test/helpers.ts";

process.loadEnvFile(new URL("../../../.env", import.meta.url).pathname);
const env = loadEnv();
for (const url of [env.DATABASE_URL, process.env.DATABASE_ADMIN_URL!]) {
  if (!["localhost", "127.0.0.1"].includes(new URL(url).hostname))
    throw new Error("Demo data is for a local database only");
}
const email = process.env.DEV_LOGIN_EMAIL!;
const password = process.env.DEV_LOGIN_PASSWORD!;

const DAY = 86_400_000;
const inDays = (d: number, hour = 12) => {
  const t = new Date(Date.now() + d * DAY);
  t.setUTCHours(hour - 3, 0, 0, 0); // Cyprus summer time
  return t;
};
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

// Messages still reach Mailpit; the script also reads the portal link and code from them.
const sent: OutboundMessage[] = [];
const mailpit = createNotifierFromEnv(process.env);
const notifier: Notifier = {
  send: async (m) => {
    sent.push(m);
    return mailpit.send(m);
  },
};

const { db, close } = createDb(env.DATABASE_URL, { max: 4 });
const admin = createDb(process.env.DATABASE_ADMIN_URL!, { max: 1 });
const store = createS3Store({
  endpoint: env.S3_ENDPOINT,
  publicEndpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  bucket: env.S3_BUCKET,
  accessKeyId: env.S3_ACCESS_KEY,
  secretAccessKey: env.S3_SECRET_KEY,
});
const auth = createAuth({
  db,
  baseURL: env.WEB_ORIGIN,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.WEB_ORIGIN],
  sendVerificationEmail: async () => {},
});
const app = await buildApp({
  db,
  auth,
  store,
  notifier,
  webOrigin: env.WEB_ORIGIN,
  rateLimitPerMinute: 10_000,
});

function check(res: { statusCode: number; body: string }, what: string) {
  if (res.statusCode >= 300) throw new Error(`${what} failed: ${res.statusCode} ${res.body}`);
  return res;
}

/** A one-page PDF saying what the document is, clearly marked as demo data. */
function pdf(lines: string[]) {
  const text = lines
    .map(
      (l, i) =>
        `BT /F1 ${i === 0 ? 16 : 11} Tf 60 ${760 - i * 24} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`,
    )
    .join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((o, i) => {
    const at = Buffer.byteLength(out);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

// ---------- Sign in as the lawyer ----------
const [factor] = await admin.db
  .select({ secret: schema.twoFactors.secret })
  .from(schema.twoFactors)
  .innerJoin(schema.users, eq(schema.users.id, schema.twoFactors.userId))
  .where(eq(schema.users.email, email));
if (!factor) throw new Error(`No account with two-factor sign-in for ${email}`);
const raw = await symmetricDecrypt({ key: env.BETTER_AUTH_SECRET, data: factor.secret });
const bits = [...Buffer.from(raw)].map((b) => b.toString(2).padStart(8, "0")).join("");
const base32 = (bits.match(/.{1,5}/g) ?? [])
  .map((c) => "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"[parseInt(c.padEnd(5, "0"), 2)])
  .join("");

const lawyer = client(app);
check(await lawyer.post("/api/auth/sign-in/email", { email, password }), "Sign-in");
check(
  await lawyer.post("/api/auth/two-factor/verify-totp", { code: totp(base32) }),
  "Two-factor sign-in",
);
const me = check(await lawyer.get("/api/v1/me"), "Reading the account").json();
const firm = me.firms[0];
if (!firm) throw new Error(`${email} has no firm`);
lawyer.useFirm(firm.id);

// ---------- The cases ----------
type Upload = { key: string; file: string; daysAgo: number; share?: boolean };
type Demo = {
  address: string;
  plot?: string;
  type: "resale" | "offplan" | "land";
  developer?: string;
  openedDaysAgo: number;
  parties: {
    role: "buyer" | "seller" | "developer" | "bank";
    fullName: string;
    email?: string;
    phone?: string;
  }[];
  // Uploads per stage, in order; the case moves on after each stage except the last.
  stages: { key: string; daysAgo: number; uploads?: Upload[] }[];
  askClient?: string[];
  deadlines?: { title: string; due: Date; notes?: string }[];
  hold?: string;
  invite?: { party: string; locale: "en" | "el" | "ru" };
};

const CASES: Demo[] = [
  {
    address: "Apartment 4, Halcyon Bay Residences, Kato Paphos 8041",
    plot: "Sheet/Plan 51/10, Plot 233",
    type: "offplan",
    developer: "Halcyon Bay Developments Ltd",
    openedDaysAgo: 34,
    parties: [
      {
        role: "buyer",
        fullName: "James Walker",
        email: "james.walker@example.com",
        phone: "+44 7700 900123",
      },
      { role: "buyer", fullName: "Sarah Walker", email: "sarah.walker@example.com" },
      { role: "developer", fullName: "Halcyon Bay Developments Ltd" },
    ],
    stages: [
      { key: "reservation", daysAgo: 34 },
      {
        key: "due_diligence",
        daysAgo: 30,
        uploads: [
          {
            key: "title_deed",
            file: "Title deed status - land title held by developer.pdf",
            daysAgo: 28,
            share: true,
          },
          {
            key: "planning_zone",
            file: "Planning permit and zoning confirmation.pdf",
            daysAgo: 27,
          },
          {
            key: "encumbrances",
            file: "Land Registry search - charges and encumbrances.pdf",
            daysAgo: 26,
          },
          {
            key: "developer",
            file: "Registrar of Companies search - Halcyon Bay Developments.pdf",
            daysAgo: 25,
          },
        ],
      },
      {
        key: "contract_signed",
        daysAgo: 4,
        uploads: [
          { key: "contract", file: "Sale contract - signed (EN-EL).pdf", daysAgo: 2, share: true },
        ],
      },
    ],
    deadlines: [
      { title: "Deposit the sale contract at the Land Registry", due: inDays(3, 10) },
      {
        title: "Pay stamp duty on the sale contract",
        due: inDays(26, 12),
        notes: "Due within 30 days of signing.",
      },
      { title: "Second payment to the developer (30%)", due: inDays(21, 12) },
    ],
    invite: { party: "James Walker", locale: "en" },
  },
  {
    address: "Villa, 12 Agiou Neofytou Street, Tala, Paphos 8577",
    plot: "Sheet/Plan 45/31, Plot 118",
    type: "resale",
    openedDaysAgo: 12,
    parties: [
      {
        role: "buyer",
        fullName: "Olga Smirnova",
        email: "olga.smirnova@example.com",
        phone: "+357 99 000111",
      },
      { role: "seller", fullName: "Georgios Hadjipetrou" },
    ],
    stages: [
      { key: "reservation", daysAgo: 12 },
      {
        key: "due_diligence",
        daysAgo: 10,
        uploads: [
          { key: "title_deed", file: "Title deed - copy from seller.pdf", daysAgo: 6, share: true },
          { key: "planning_zone", file: "Town planning zone - residential.pdf", daysAgo: 5 },
        ],
      },
    ],
    deadlines: [
      { title: "Reply to the seller's lawyer on the draft contract", due: inDays(1, 17) },
      { title: "Search the Land Registry for charges and encumbrances", due: inDays(5, 12) },
    ],
  },
  {
    address: "Apartment 12, 3 Amathountos Avenue, Germasogeia, Limassol 4041",
    plot: "Sheet/Plan 55/4, Plot 702",
    type: "resale",
    openedDaysAgo: 61,
    parties: [
      {
        role: "buyer",
        fullName: "Daniel Cohen",
        email: "daniel.cohen@example.com",
        phone: "+972 50 000 0000",
      },
      { role: "seller", fullName: "Eleni Constantinou" },
      { role: "bank", fullName: "Seller's mortgage lender" },
    ],
    stages: [
      { key: "reservation", daysAgo: 61 },
      {
        key: "due_diligence",
        daysAgo: 58,
        uploads: [
          {
            key: "title_deed",
            file: "Title deed - issued in seller's name.pdf",
            daysAgo: 52,
            share: true,
          },
          {
            key: "planning_zone",
            file: "Certificate of final approval and zoning.pdf",
            daysAgo: 52,
          },
          {
            key: "encumbrances",
            file: "Land Registry search - one mortgage to be released.pdf",
            daysAgo: 50,
          },
          { key: "developer", file: "Seller identity check.pdf", daysAgo: 50 },
        ],
      },
      {
        key: "contract_signed",
        daysAgo: 44,
        uploads: [
          { key: "contract", file: "Sale contract - signed.pdf", daysAgo: 40, share: true },
        ],
      },
      {
        key: "contract_deposited",
        daysAgo: 40,
        uploads: [
          {
            key: "deposited_contract",
            file: "Land Registry deposit receipt.pdf",
            daysAgo: 33,
            share: true,
          },
        ],
      },
      { key: "payments", daysAgo: 33 },
    ],
    askClient: ["funds"],
    deadlines: [{ title: "Final payment from the buyer", due: inDays(12, 12) }],
    invite: { party: "Daniel Cohen", locale: "en" },
  },
  {
    address: "House, 8 Archiepiskopou Makariou III Avenue, Aradippou, Larnaca 7101",
    plot: "Sheet/Plan 41/7, Plot 112",
    type: "resale",
    openedDaysAgo: 95,
    parties: [
      {
        role: "buyer",
        fullName: "Nikos Georgiou",
        email: "nikos.georgiou@example.com",
        phone: "+357 99 000222",
      },
      { role: "seller", fullName: "Andreas Kyriakides" },
    ],
    stages: [
      { key: "reservation", daysAgo: 95 },
      {
        key: "due_diligence",
        daysAgo: 92,
        uploads: [
          { key: "title_deed", file: "Title deed - issued.pdf", daysAgo: 88 },
          { key: "planning_zone", file: "Planning zone - residential.pdf", daysAgo: 88 },
          { key: "encumbrances", file: "Land Registry search - no charges.pdf", daysAgo: 86 },
          { key: "developer", file: "Seller identity check.pdf", daysAgo: 86 },
        ],
      },
      {
        key: "contract_signed",
        daysAgo: 80,
        uploads: [{ key: "contract", file: "Sale contract - signed.pdf", daysAgo: 78 }],
      },
      {
        key: "contract_deposited",
        daysAgo: 76,
        uploads: [
          { key: "deposited_contract", file: "Land Registry deposit receipt.pdf", daysAgo: 70 },
        ],
      },
      {
        key: "payments",
        daysAgo: 70,
        uploads: [
          { key: "funds", file: "Client account statement - full price held.pdf", daysAgo: 30 },
        ],
      },
      { key: "final_approval", daysAgo: 30 },
      { key: "title_transfer", daysAgo: 21 },
    ],
    deadlines: [
      { title: "Transfer appointment at the Larnaca District Land Office", due: inDays(9, 9) },
    ],
  },
  {
    address: "Apartment 3, 17 Kyriakou Matsi Street, Strovolos, Nicosia 2018",
    plot: "Sheet/Plan 21/46, Plot 590",
    type: "offplan",
    developer: "Olympus Ridge Developments Ltd",
    openedDaysAgo: 140,
    parties: [
      {
        role: "buyer",
        fullName: "Maria Ioannou",
        email: "maria.ioannou@example.com",
        phone: "+357 99 000333",
      },
      { role: "developer", fullName: "Olympus Ridge Developments Ltd" },
      { role: "bank", fullName: "Developer's mortgage lender" },
    ],
    stages: [
      { key: "reservation", daysAgo: 140 },
      {
        key: "due_diligence",
        daysAgo: 138,
        uploads: [
          {
            key: "title_deed",
            file: "Land title - held by developer, mortgaged.pdf",
            daysAgo: 132,
          },
          { key: "planning_zone", file: "Building permit.pdf", daysAgo: 132 },
          {
            key: "encumbrances",
            file: "Land Registry search - developer mortgage.pdf",
            daysAgo: 130,
          },
          {
            key: "developer",
            file: "Registrar of Companies search - Olympus Ridge.pdf",
            daysAgo: 130,
          },
        ],
      },
      {
        key: "contract_signed",
        daysAgo: 125,
        uploads: [{ key: "contract", file: "Sale contract - signed.pdf", daysAgo: 124 }],
      },
      {
        key: "contract_deposited",
        daysAgo: 120,
        uploads: [
          { key: "deposited_contract", file: "Land Registry deposit receipt.pdf", daysAgo: 110 },
        ],
      },
      {
        key: "payments",
        daysAgo: 110,
        uploads: [
          { key: "funds", file: "Payment schedule - all instalments paid.pdf", daysAgo: 45 },
        ],
      },
      { key: "final_approval", daysAgo: 45 },
      { key: "title_transfer", daysAgo: 20 },
    ],
    deadlines: [
      { title: "Chase the developer's bank for the mortgage release letter", due: inDays(1, 12) },
    ],
    hold: "The developer's mortgage over the land has not been released, so the title deed cannot be transferred yet.",
  },
];

const existing = await admin.db
  .select({ address: schema.cases.propertyAddress })
  .from(schema.cases)
  .where(
    inArray(
      schema.cases.propertyAddress,
      CASES.map((c) => c.address),
    ),
  );
if (existing.length > 0) {
  console.log("The demo cases are already loaded. Nothing to do.");
  await app.close();
  await Promise.all([close(), admin.close()]);
  process.exit(0);
}

let etag = "";
const withVersion = (res: { headers: Record<string, unknown> }) => {
  etag = String(res.headers.etag);
  return res;
};

async function upload(caseId: string, demo: Demo, u: Upload, expiryDays: number | null) {
  const body = pdf([
    u.file.replace(/\.pdf$/, ""),
    demo.address,
    "Demo document for the Kleidi prototype. Fictional, not a real record.",
  ]);
  const link = check(
    await lawyer.post(`/api/v1/cases/${caseId}/documents/uploads`, {
      requirementKey: u.key,
      fileName: u.file,
      mimeType: "application/pdf",
      byteSize: body.length,
    }),
    `Upload of ${u.file}`,
  ).json();
  const put = await fetch(link.uploadUrl, { method: "PUT", headers: link.uploadHeaders, body });
  if (!put.ok) throw new Error(`Storage refused ${u.file}: ${put.status}`);
  // A search that would have lapsed by now belongs to a finished stage, so it keeps no expiry.
  const left = expiryDays ? expiryDays - u.daysAgo : null;
  const expiresOn = left === null ? undefined : left > 0 ? isoDate(inDays(left)) : null;
  check(
    await lawyer.post(`/api/v1/documents/versions/${link.versionId}/complete`, { expiresOn }),
    "Completing upload",
  );
  if (u.share)
    check(
      await lawyer.patch(`/api/v1/documents/${link.documentId}`, { visibility: "client" }),
      "Sharing",
    );
  return { versionId: link.versionId as string, daysAgo: u.daysAgo };
}

/** Waits until the worker has scanned every upload, so the checklist sees them as done. */
async function waitForScans() {
  for (let i = 0; ; i++) {
    const [row] = await admin.db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.documentVersions)
      .where(inArray(schema.documentVersions.scanStatus, ["uploading", "pending"]));
    if (row!.n === 0) return;
    if (i === 90)
      throw new Error("The files were not scanned. Is the worker running (`pnpm dev`)?");
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const EXPIRY: Record<string, number> = { encumbrances: 30, developer: 90 };
const backdate: {
  caseId: string;
  demo: Demo;
  versions: { versionId: string; daysAgo: number }[];
}[] = [];

for (const demo of CASES) {
  const created = withVersion(
    check(
      await lawyer.post("/api/v1/cases", {
        propertyAddress: demo.address,
        plotOrRegNo: demo.plot,
        propertyType: demo.type,
        developerName: demo.developer,
        parties: demo.parties,
      }),
      `Opening ${demo.address}`,
    ),
  );
  const caseId = created.json().id as string;
  const versions: { versionId: string; daysAgo: number }[] = [];

  for (const [i, stage] of demo.stages.entries()) {
    for (const u of stage.uploads ?? [])
      versions.push(await upload(caseId, demo, u, EXPIRY[u.key] ?? null));
    if (i < demo.stages.length - 1) {
      await waitForScans();
      withVersion(
        check(
          await lawyer.post(
            `/api/v1/cases/${caseId}/transitions`,
            { kind: "advance" },
            { "if-match": etag },
          ),
          "Moving the case on",
        ),
      );
    }
  }

  for (const key of demo.askClient ?? [])
    check(
      await lawyer.post(`/api/v1/cases/${caseId}/documents/requests`, {
        requirementKey: key,
        requested: true,
      }),
      "Asking the client",
    );
  for (const d of demo.deadlines ?? [])
    check(
      await lawyer.post(`/api/v1/cases/${caseId}/deadlines`, {
        title: d.title,
        dueAt: d.due.toISOString(),
        notes: d.notes,
        remindBeforeHours: [72, 24],
      }),
      "Adding a deadline",
    );

  if (demo.invite) {
    const detail = check(await lawyer.get(`/api/v1/cases/${caseId}`), "Reading the case").json();
    const party = detail.parties.find(
      (p: { fullName: string }) => p.fullName === demo.invite!.party,
    );
    check(
      await lawyer.post(`/api/v1/cases/${caseId}/parties/${party.id}/portal`, {
        locale: demo.invite.locale,
      }),
      "Inviting to the portal",
    );
  }
  if (demo.hold) {
    withVersion(check(await lawyer.get(`/api/v1/cases/${caseId}`), "Reading the case"));
    check(
      await lawyer.post(
        `/api/v1/cases/${caseId}/transitions`,
        { kind: "hold", reason: demo.hold },
        { "if-match": etag },
      ),
      "Putting the case on hold",
    );
  }
  backdate.push({ caseId, demo, versions });
  console.log(`Opened ${created.json().reference}: ${demo.address}`);
}

// ---------- Daniel Cohen sends a document through the portal ----------
const invite = sent.find((m) => m.to === "daniel.cohen@example.com" && m.channel === "email");
const token = /\/portal\/link\/([^"/?\s]+)/.exec(JSON.stringify(invite?.data ?? {}))?.[1];
if (!token) throw new Error("No portal invitation found for Daniel Cohen");
const buyer = client(app);
check(await buyer.post(`/api/portal/link/${token}/start`, {}), "Opening the portal link");
const sms = sent.filter((m) => m.channel === "sms").at(-1);
const code = /\b(\d{6})\b/.exec(JSON.stringify(sms?.data ?? {}))?.[1];
if (!code) throw new Error("No portal code found");
check(await buyer.post(`/api/portal/link/${token}/verify`, { code }), "Entering the portal code");
check(await buyer.post("/api/portal/privacy/accept", {}), "Accepting the privacy notice");
const portalCase = check(await buyer.get("/api/portal/case"), "Reading the portal case").json();
const wanted = portalCase.documents.find(
  (d: { requirementKey: string | null }) => d.requirementKey === "funds",
);
const transfer = pdf([
  "Bank transfer confirmation",
  "Daniel Cohen to Christou & Co client account",
  "Demo document. Fictional.",
]);
const clientLink = check(
  await buyer.post("/api/portal/uploads", {
    documentId: wanted.id,
    fileName: "Bank transfer confirmation.pdf",
    mimeType: "application/pdf",
    byteSize: transfer.length,
  }),
  "Client upload",
).json();
const put = await fetch(clientLink.uploadUrl, {
  method: "PUT",
  headers: clientLink.uploadHeaders,
  body: transfer,
});
if (!put.ok) throw new Error(`Storage refused the client upload: ${put.status}`);
check(
  await buyer.post(`/api/portal/uploads/${clientLink.versionId}/complete`, {}),
  "Completing the client upload",
);
console.log("Daniel Cohen sent a bank transfer confirmation through the portal.");

// ---------- Set realistic dates ----------
await waitForScans();
const ago = (d: number) => new Date(Date.now() - d * DAY);
await admin.db.transaction(async (tx) => {
  for (const { caseId, demo, versions } of backdate) {
    await tx
      .update(schema.cases)
      .set({ createdAt: ago(demo.openedDaysAgo) })
      .where(eq(schema.cases.id, caseId));
    const stages = await tx
      .select()
      .from(schema.caseStages)
      .where(eq(schema.caseStages.caseId, caseId));
    for (const [i, stage] of demo.stages.entries()) {
      const row = stages.find((s) => s.stageKey === stage.key);
      if (!row) continue;
      const next = demo.stages[i + 1];
      await tx
        .update(schema.caseStages)
        .set({ enteredAt: ago(stage.daysAgo), completedAt: next ? ago(next.daysAgo) : null })
        .where(eq(schema.caseStages.id, row.id));
    }
    for (const v of versions) {
      const at = ago(v.daysAgo);
      await tx
        .update(schema.documentVersions)
        .set({ createdAt: at, scannedAt: at, reviewedAt: at })
        .where(eq(schema.documentVersions.id, v.versionId));
    }
  }
  // Deadlines cannot be set in the past through the API; this one shows as overdue.
  await tx
    .update(schema.deadlines)
    .set({ dueAt: inDays(-2, 12) })
    .where(
      eq(schema.deadlines.title, "Chase the developer's bank for the mortgage release letter"),
    );
});

console.log(`\nDemo data loaded. Sign in at ${env.WEB_ORIGIN} as ${email}.`);
await app.close();
await Promise.all([close(), admin.close()]);
