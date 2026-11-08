import { createServer, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ensureLegalBucket, InfraiError, infrai } from "./infrai.ts";
import { selectDeadlineFollowups, type MatterDeadline } from "./deadline_followup.ts";

const bucket = process.env.LEGAL_FILES_BUCKET ?? "private-legal-matters";
const port = Number(process.env.PORT ?? 3000);

const intakeSchema = z.object({
  clientEmail: z.string().email(),
  matterType: z.enum(["contract-review", "employment", "estate"]),
  deadline: z.string().date(),
  document: z.object({
    name: z.string().min(1).max(120),
    contentBase64: z.string().min(1),
  }),
}).strict();

const followupSchema = z.object({ asOf: z.string().date() }).strict();
const matters: MatterDeadline[] = [];

async function readJson(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(value));
}

function mapError(response: ServerResponse, error: unknown): void {
  if (error instanceof z.ZodError) {
    json(response, 400, { error: "invalid_request", issues: error.issues });
    return;
  }
  if (error instanceof InfraiError) {
    const status = error.status >= 400 && error.status < 500 ? error.status : 502;
    json(response, status, { error: error.code, message: error.message });
    return;
  }
  json(response, 500, { error: "internal_error" });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (request.method === "POST" && url.pathname === "/matters") {
      const input = intakeSchema.parse(await readJson(request));
      const matterId = randomUUID();
      const documentId = randomUUID();
      const objectKey = `matters/${matterId}/${documentId}`;
      await infrai.storage.object.put(bucket, objectKey, { data_base64: input.document.contentBase64 });
      matters.push({
        matterId,
        clientEmail: input.clientEmail,
        deadline: input.deadline,
        status: "open",
      });
      json(response, 201, { matterId, documentId, state: "intake-recorded" });
      return;
    }

    const download = url.pathname.match(/^\/matters\/([^/]+)\/documents\/([^/]+)\/download$/);
    if (request.method === "GET" && download) {
      const sessionId = url.searchParams.get("session_id");
      if (!sessionId) {
        json(response, 400, { error: "session_id_required" });
        return;
      }
      await infrai.auth.session.verify(sessionId);
      const objectKey = `matters/${download[1]}/${download[2]}`;
      const object = await infrai.storage.object.head(bucket, objectKey);
      if (!object.found) {
        json(response, 404, { error: "document_not_found" });
        return;
      }
      const signed = await infrai.storage.object.presign(bucket, objectKey, {
        op: "get",
        expires_seconds: 300,
        response_disposition: "attachment",
      });
      json(response, 200, { downloadUrl: signed.url, expiresSeconds: 300 });
      return;
    }

    if (request.method === "POST" && url.pathname === "/deadline-followups") {
      const input = followupSchema.parse(await readJson(request));
      json(response, 200, { followups: selectDeadlineFollowups(matters, input.asOf) });
      return;
    }

    json(response, 404, { error: "route_not_found" });
  } catch (error) {
    mapError(response, error);
  }
});

await ensureLegalBucket(bucket);
server.listen(port, () => {
  console.log(`Legal file service listening on http://localhost:${port}`);
});
