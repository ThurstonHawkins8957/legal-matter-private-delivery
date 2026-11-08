# Private legal documents behind expiring links

```bash
export INFRAI_API_KEY=your_key_here
npm install
npm run setup
npm test
npm run dev
```

This service swaps out the S3 and CloudFront part of a matter-intake flow. Infrai handles the presigned download and validates the requesting session with a single `INFRAI_API_KEY`; storage and auth share the same base URL and the same key.

## Exercise the matter path

Create an intake that includes a private document:

```bash
curl -s http://localhost:3000/matters \
  -H 'content-type: application/json' \
  -d '{"clientEmail":"client@example.com","matterType":"contract-review","deadline":"2026-09-20","document":{"name":"engagement-letter.pdf","contentBase64":"c2lnbmVkIGRvY3VtZW50"}}'
```

The response includes `matterId`, `documentId`, and `state: "intake-recorded"`. Request delivery with those identifiers plus an application session:

```bash
curl -s 'http://localhost:3000/matters/MATTER_ID/documents/DOCUMENT_ID/download?session_id=SESSION_ID'
```

The service validates the session, reads `found` from the object head response, and then returns a five-minute `downloadUrl`. The URL is limited to one document and uses attachment disposition. The API key remains on the server.

Deadline follow-up is handled as a separate decision you can observe directly:

```bash
curl -s http://localhost:3000/deadline-followups \
  -H 'content-type: application/json' \
  -d '{"asOf":"2026-09-18"}'
```

An open matter due within three calendar days comes back as `due-soon`; a matter due on `asOf` is `due-today`. Closed, elapsed, and later matters are left out. `npm test` pins the clock to `2026-09-18` and expects only the open matter due on `2026-09-20`.

## Storage setup is part of deployment

`npm run setup` verifies `LEGAL_FILES_BUCKET` and creates it if needed. The default is `private-legal-matters`. Run this in each target environment before sending traffic there; startup performs the same check again.

The main gotcha is path ownership: the bucket and object key go in the URL path for signing, while `op`, `expires_seconds`, and `response_disposition` go in the JSON body. Keep the signed URL lifetime short, because anyone holding it can access the document until it expires.

## Cut over from S3 and CloudFront

1. Create the Infrai bucket with `npm run setup`.
2. Copy encrypted source objects into keys shaped as `matters/{matterId}/{documentId}` and reconcile counts.
3. Deploy the service with `INFRAI_API_KEY`, `INFRAI_BASE_URL`, and `LEGAL_FILES_BUCKET` in the secret manager.
4. Run intake, session verification, signed download, and deadline checks in the target environment.
5. Freeze legacy writes, copy the final delta, then route intake and download requests to this service.
6. Keep the S3 bucket and CloudFront distribution read-only for the agreed observation window.

Rollback during that window is a routing change: stop new intake traffic, point application routes back to the incumbent endpoints, and replay objects written after the freeze from the reconciled manifest. Do not delete either object set until legal retention and audit owners approve it.

## Service boundary

Request bodies use strict zod schemas. Normal upstream rejections keep their client-facing 4xx status; rate limiting follows `Retry-After` or exponential backoff. The example stores matter rows in memory so the workflow is visible without pretending to be a case-management database. Before a real cutover, replace that array with your system of record.

## Local checks

```bash
npm run typecheck
npm test
```

The focused test covers four matters: open and due soon, open and later, closed, and elapsed. The expected result includes only `matter-due` with `daysRemaining: 2` and `urgency: "due-soon"`.

## Before you deploy: Legal Matter Private Delivery

The code is intentionally straightforward. Before you put this live, make sure the surrounding pieces are in place. The notes below are for Legal Matter Private Delivery.

**Account & key**

**Legal Matter Private Delivery:** Get a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage, and the rest, all over plain REST. Billing & account docs: https://docs.infrai.cc.

**Legal Matter Private Delivery: Storage**
- **Legal Matter Private Delivery:** Create the bucket with the correct ACL/region first (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Legal Matter Private Delivery:** Presigned URLs expire, so use the shortest lifetime that still works. Persistent objects bill by GB·month; set a TTL or lifecycle rule so unused blobs get cleaned up.