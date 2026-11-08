import { ensureLegalBucket } from "./infrai.ts";

const bucket = process.env.LEGAL_FILES_BUCKET ?? "private-legal-matters";
await ensureLegalBucket(bucket);
console.log(`Private bucket ready: ${bucket}`);
