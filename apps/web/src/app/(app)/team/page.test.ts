import assert from "node:assert/strict";
import { test } from "node:test";
import TeamRoomPage from "./page";

test("the old team room sends people to Conversations", () => {
  assert.throws(
    () => TeamRoomPage(),
    (error: { digest?: string }) => /^NEXT_REDIRECT;\w+;\/rooms;/.test(String(error.digest)),
  );
});
