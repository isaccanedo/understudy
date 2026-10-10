import assert from "node:assert/strict";
import { test } from "node:test";
import { computerLimit, RateLimiter } from "./rate-limit";

test("rate limiter allows a burst and then refuses", () => {
  const limiter = new RateLimiter();
  let allowed = 0;
  for (let i = 0; i < 20; i++) if (limiter.allow("agent:approval_request", 1, 5)) allowed += 1;
  assert.equal(allowed, 5);
});

test("rate limiter keys are independent", () => {
  const limiter = new RateLimiter();
  for (let i = 0; i < 5; i++) limiter.allow("a:chat", 1, 5);
  assert.equal(limiter.allow("a:chat", 1, 5), false);
  assert.equal(limiter.allow("b:chat", 1, 5), true);
});

test("approval requests are limited harder than frames", () => {
  assert.ok(computerLimit("approval_request")[0] < computerLimit("frame")[0]);
});
