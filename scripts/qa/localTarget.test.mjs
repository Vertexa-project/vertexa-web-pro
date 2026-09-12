import assert from "node:assert/strict";
import { test } from "node:test";

import {
  assertFactoryApiUrl,
  isRunOwnedEmail,
  newRunId,
  qaEmail,
  RUN_ID_RE,
} from "./localTarget.mjs";

test("run_id e e-mails QA", () => {
  const runId = newRunId();
  assert.match(runId, RUN_ID_RE);
  assert.equal(qaEmail(runId, "owner"), `qa+${runId}-owner@example.test`);
  assert.equal(isRunOwnedEmail(qaEmail(runId, "pending"), runId), true);
  assert.equal(isRunOwnedEmail("person@gmail.com", runId), false);
});

test("recusa supabase remoto e produção", () => {
  assert.throws(() => assertFactoryApiUrl("https://cdhjfyyuhmwrcuxqavib.supabase.co"), /REFUSED/);
  assert.throws(() => assertFactoryApiUrl("https://xyz.supabase.co"), /supabase\.co/);
  assert.throws(() => assertFactoryApiUrl("https://example.com"), /hostname/);
  assert.equal(assertFactoryApiUrl("http://127.0.0.1:55621"), "http://127.0.0.1:55621");
  assert.equal(assertFactoryApiUrl("http://localhost:5173"), "http://localhost:5173");
});
