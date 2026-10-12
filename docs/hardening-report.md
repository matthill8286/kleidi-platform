# Hardening report (Milestone 6)

Date: 12 October 2026. Branch: `feature/m6-hardening`.

This report records what was tested before launch, what was found, and what was fixed. The external penetration test is still to be booked; its findings will be added here.

## Summary

| Check                     | Result                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ |
| OWASP ZAP baseline scan   | 0 failures, 63 checks passed, 4 warnings accepted (see below)                  |
| Load test                 | 506 requests per second on one CPU, p95 161 ms, 0 errors                       |
| White-box security review | 1 high, 5 medium, 5 low findings. The high and all medium findings are fixed.  |
| Restore drill             | Pass: every row count matches, row-level security and the audit guard restored |
| External penetration test | Not yet booked. Needs a CREST or OSCP-qualified firm and the staging URL.      |

## ZAP baseline scan

ZAP ran against the production image (`docker build --target api`), which serves the web app and the API together.

The first scan found 0 failures and 6 warnings. These were fixed:

- **Google Fonts.** The page loaded fonts from Google, which forced a broad security policy for fonts and styles and sent every visitor's address to Google. The fonts are now served with the app, and the policy allows fonts and stylesheets only from the app itself.
- **No Permissions-Policy header.** Every response now switches off the camera, microphone, location, payment and USB features.
- **No cache rules.** Hashed build files are cached for a year. `index.html` is checked on every visit, so a release reaches users at once.
- **No integrity check on the external font link.** This went away with self-hosting.

The second scan found 0 failures and 4 warnings, all accepted:

- **"Storable and cacheable content"** is the intended long cache on hashed files.
- **"style-src unsafe-inline"** is needed because React sets inline `style` attributes. Scripts remain locked to the app's own origin, which is where the real risk lies.
- **"Modern web application"** is informational.
- **"Cross-Origin-Embedder-Policy missing"** is accepted: the app embeds nothing cross-origin, and requiring it would break downloads from object storage.

## Load test

Script: `infra/load/run.ts`.

Set-up:

- 50 sessions across 10 lawyers for 60 seconds, against the production image.
- The container was limited to 1 CPU and 512 MB, which is smaller than the planned production size.
- It ran on the local Postgres.

The traffic mix approximates a lawyer's day: lists, case pages, checklists, activity, deadlines, and opening new cases.

| Request       | Count  | p50 ms | p95 ms | p99 ms | Errors |
| ------------- | ------ | ------ | ------ | ------ | ------ |
| List cases    | 9,110  | 70     | 116    | 135    | 0      |
| Open case     | 5,988  | 78     | 124    | 143    | 0      |
| My deadlines  | 3,105  | 70     | 115    | 130    | 0      |
| Activity      | 4,526  | 102    | 148    | 167    | 0      |
| Checklist     | 6,094  | 133    | 175    | 196    | 0      |
| Open new case | 1,522  | 155    | 196    | 212    | 0      |
| All           | 30,345 | 94     | 161    | 187    | 0      |

The pilot plans for five firms of about ten users each. At 506 requests per second, one small container has more than ten times the headroom that pilot needs. Memory stayed at about 120 MB.

The load test also found a real problem. The worker took one event every two seconds from each queue, which is pg-boss's default, so a busy firm would have built a backlog. Each queue now takes up to 25 jobs every half second.

## Security review findings

| ID  | Severity | Finding                                                                                                                                       | Status                                                                                                                                                                                                                                     |
| --- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| H1  | High     | A client's uploads were visible to other portal parties on the same case, and a client could add a version to a document the firm had shared. | Fixed. Clients see only their own files plus files the firm uploaded and shared, and they upload only where asked or to documents they started. Tested with a buyer and a seller on one case.                                              |
| M1  | Medium   | `trustProxy: true` let a client fake its address and dodge rate limits.                                                                       | Fixed. Only the configured number of proxy hops is trusted (`TRUSTED_PROXIES`, 1 in production).                                                                                                                                           |
| M2  | Medium   | A file could be swapped between the virus scan and its release.                                                                               | Fixed. The release copies only the object with the ETag that was scanned; a changed file fails the copy and is scanned again.                                                                                                              |
| M3  | Medium   | Portal access kept old contact details after a change, and old links survived a revocation.                                                   | Fixed. A contact change ends sessions and links. Revoking or re-inviting spends every outstanding link. Removing a party ends access at once.                                                                                              |
| M4  | Medium   | There was no email verification, so a leaked invitation link could let someone register the invitee's address.                                | Fixed. Nobody can sign in until they confirm their address.                                                                                                                                                                                |
| M5  | Medium   | The SMS and email sending could be used for toll fraud or phishing.                                                                           | Mostly fixed. Texts go only to an allow-list of countries, sign-in emails are limited to one every two minutes per client, and in production only approved emails can create a firm (`FIRM_CREATORS`). A per-firm SMS quota is still open. |
| L1  | Low      | Tokens appeared in request logs and stayed in the outbox.                                                                                     | Fixed. Token paths are redacted in logs, and relayed outbox rows are purged after 7 days.                                                                                                                                                  |
| L2  | Low      | Sign-in link requests were slow and their timing revealed whether an email was known.                                                         | Fixed for timing: the form answers at once. The per-firm lookup remains and should move to an indexed lookup before more than about 100 firms.                                                                                             |
| L3  | Low      | Idempotency keys were not scoped to the firm and were kept forever.                                                                           | Fixed. The firm is part of the request hash, and keys are purged after 24 hours.                                                                                                                                                           |
| L4  | Low      | The redirect check after sign-in accepted `/\evil.com`.                                                                                       | Fixed. The path must resolve to the app's own origin.                                                                                                                                                                                      |
| L5  | Low      | Some lists had no limit.                                                                                                                      | Fixed. Activity and deadline lists are capped at 500 rows.                                                                                                                                                                                 |

Informational items, and what happened to them:

- **Downloads were not audited.** Fixed: every download, by staff or by a client, is now an audit event and appears in the case activity.
- **The firm header accepted a malformed id.** Fixed: it must be a well-formed UUID.
- **The API description was public.** Fixed: `/openapi.json` is not served in production.
- **Staff could invite clients and share documents.** Accepted for the pilot, and to be reviewed with the pilot firms.
- **There was no way to remove a firm member.** Fixed: a firm admin can remove someone, a firm always keeps at least one admin, and the removed person's access ends at once.
- **The audit trail keeps personal data.** Open. This needs a documented position in the DPIA: legal-hold retention versus erasure.
- **`audit_events.ip` is never set.** Open.
- **File types are trusted from the browser.** Accepted. Files are virus-scanned and always downloaded as attachments from a separate origin.

## Restore drill

Script: `infra/scripts/restore-drill.sh`. It backs up the database, restores it into a fresh database and then checks:

- the row counts of ten core tables;
- that row-level security is on for the key tables;
- that the append-only trigger on `audit_events` exists;
- that the app role sees no rows without a firm set.

On the development database (1 MB, 414 users) it passed in 3 seconds. In production it runs monthly against a restored managed backup. See `docs/runbook.md`.

## Still to do before the pilot goes live

1. Book the external penetration test against staging and fix its high findings.
2. Add a per-firm SMS quota.
3. Finish the DPIA, including the audit-trail retention position.
4. Get professional translations for Greek and Russian.
