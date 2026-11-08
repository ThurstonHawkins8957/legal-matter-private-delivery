import assert from "node:assert/strict";
import test from "node:test";
import { selectDeadlineFollowups } from "../src/deadline_followup.ts";

test("selects only open matters due within three days", () => {
  const result = selectDeadlineFollowups([
    { matterId: "matter-due", clientEmail: "client@example.com", deadline: "2026-09-20", status: "open" },
    { matterId: "matter-later", clientEmail: "later@example.com", deadline: "2026-09-25", status: "open" },
    { matterId: "matter-closed", clientEmail: "closed@example.com", deadline: "2026-09-19", status: "closed" },
    { matterId: "matter-past", clientEmail: "past@example.com", deadline: "2026-09-17", status: "open" },
  ], "2026-09-18");

  assert.deepEqual(result, [{
    matterId: "matter-due",
    clientEmail: "client@example.com",
    daysRemaining: 2,
    urgency: "due-soon",
  }]);
});
