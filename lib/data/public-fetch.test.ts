import assert from "node:assert/strict";
import test from "node:test";
import { pinnedLookup } from "./public-fetch";

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
