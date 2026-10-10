import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultModel, effectiveModel } from "./models";

test("the agent's choice wins, then the server default, then the brain's own default", () => {
  assert.equal(effectiveModel("opus", { UNDERSTUDY_DEFAULT_MODEL: "haiku" }), "opus");
  assert.equal(effectiveModel(null, { UNDERSTUDY_DEFAULT_MODEL: " Sonnet " }), "sonnet");
  assert.equal(effectiveModel("gpt-9", { UNDERSTUDY_DEFAULT_MODEL: "haiku" }), "haiku");
  assert.equal(effectiveModel(null, {}), null);
  assert.equal(defaultModel({ UNDERSTUDY_DEFAULT_MODEL: "claude-opus-5; rm -rf" }), null);
});
