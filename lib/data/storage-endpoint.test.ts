import assert from "node:assert/strict";
import test from "node:test";
import { databaseEndpoint } from "./storage";

test("shared Supabase transaction URLs use session mode with the same credentials", () => {
  const input = "postgres://postgres.project:encoded%40secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require";
  const endpoint = new URL(databaseEndpoint(input));
  assert.equal(endpoint.port, "5432");
  assert.equal(endpoint.hostname, "aws-0-us-east-1.pooler.supabase.com");
  assert.equal(endpoint.username, "postgres.project");
  assert.equal(endpoint.password, "encoded%40secret");
  assert.equal(endpoint.searchParams.get("sslmode"), "require");
  assert.equal(databaseEndpoint("postgres://localhost:6543/postgres"), "postgres://localhost:6543/postgres");
});
