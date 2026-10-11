import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { discardResponseBody, pinnedLookup } from "./public-fetch";

test("discarded HTTP bodies survive an asynchronous abort during dispatcher cleanup", async () => {
  const body = new Readable({
    read() {},
    destroy(_error, callback) {
      setImmediate(() => callback(Object.assign(new Error("Request aborted"), { name: "AbortError" })));
    },
  });
  const closed = new Promise<void>(resolve => body.once("close", resolve));
  discardResponseBody(body);
  await closed;
  assert.equal(body.destroyed, true);
  // Without an error listener, the asynchronous AbortError terminates the
  // process instead of allowing the caller to report HTTP failure or redirect.
  assert.equal(body.errored?.name, "AbortError");
});

test("pinned public lookup honors Node address-list requests without resolving again", () => {
  const address = { address: "203.0.113.10", family: 4 };
  const lookup = pinnedLookup(address);
  lookup("example.com", { all: true }, (error, result) => {
    assert.equal(error, null);
    assert.deepEqual(result, [address]);
  });
  lookup("example.com", {}, (error, result, family) => {
    assert.equal(error, null);
    assert.equal(result, address.address);
    assert.equal(family, 4);
  });
});
