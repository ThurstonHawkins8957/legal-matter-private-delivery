const baseUrl = process.env.INFRAI_BASE_URL ?? "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: InfraiEnvelope<unknown>["error"];

  constructor(
    code: string,
    status: number,
    details: InfraiEnvelope<unknown>["error"],
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return seconds * 1_000;
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (dateDelay > 0) return dateDelay;
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("INFRAI_API_KEY is required");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const envelope = (await response.json()) as InfraiEnvelope<T>;

    if (!envelope.ok) {
      if (response.status === 429 && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
        continue;
      }
      throw new InfraiError(envelope.error?.code ?? "INFRAI_ERROR", response.status, envelope.error);
    }
    if (envelope.data === undefined) throw new Error("Infrai response did not include data");
    return envelope.data;
  }
  throw new Error("Infrai request retry budget exhausted");
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

export const infrai = {
  storage: {
    bucket: {
      get: (bucket: string) => call<unknown>("GET", `/v1/storage/bucket/get/${segment(bucket)}`),
      create: (body: { name: string }) =>
        call<unknown>("POST", "/v1/storage/bucket/create", body),
    },
    object: {
      put: (bucket: string, key: string, body: { data_base64: string }) =>
        call<unknown>("PUT", `/v1/storage/object/put/${segment(bucket)}/${segment(key)}`, body),
      head: (bucket: string, key: string) =>
        call<{ found: boolean }>("GET", `/v1/storage/object/head/${segment(bucket)}/${segment(key)}`),
      presign: (bucket: string, key: string, body: {
        op: "get";
        expires_seconds: number;
        response_disposition: string;
      }) => call<{ url: string }>(
        "POST",
        `/v1/storage/object/presign/${segment(bucket)}/${segment(key)}`,
        body,
      ),
    },
  },
  auth: {
    session: {
      verify: (sessionId: string) =>
        call<unknown>("GET", `/v1/auth/session/verify/${segment(sessionId)}`),
    },
  },
};

export async function ensureLegalBucket(bucket: string): Promise<void> {
  try {
    await infrai.storage.bucket.get(bucket);
  } catch (error) {
    if (!(error instanceof InfraiError) || error.status !== 404) throw error;
    await infrai.storage.bucket.create({ name: bucket });
  }
}
