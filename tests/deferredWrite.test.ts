import test from "node:test";
import assert from "node:assert/strict";

import { createDeferredWriter } from "../lib/deferredWrite";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("deferred writer coalesces queued writes and commits only the latest value", async () => {
  const committed: number[] = [];
  const writer = createDeferredWriter<number>((value) => {
    committed.push(value);
  }, 10);

  const first = writer.schedule(1);
  const second = writer.schedule(2);

  await Promise.all([first, second]);

  assert.deepEqual(committed, [2]);
});

test("deferred writer flushes pending work immediately", async () => {
  const committed: string[] = [];
  const writer = createDeferredWriter<string>((value) => {
    committed.push(value);
  }, 50);

  const pending = writer.schedule("latest");
  assert.equal(writer.hasPendingWrite(), true);

  await writer.flush();
  await pending;
  await sleep(60);

  assert.deepEqual(committed, ["latest"]);
  assert.equal(writer.hasPendingWrite(), false);
});

test("deferred writer immediate mode bypasses debounce", async () => {
  const committed: string[] = [];
  const writer = createDeferredWriter<string>((value) => {
    committed.push(value);
  }, 100);

  await writer.schedule("now", { immediate: true });

  assert.deepEqual(committed, ["now"]);
  assert.equal(writer.hasPendingWrite(), false);
});
