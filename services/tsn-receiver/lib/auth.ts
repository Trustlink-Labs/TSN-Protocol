import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

function equal(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireService(request: NextRequest, service: "node") {
  const expected = service === "node" ? process.env.TSN_RECEIVER_NODE_API_KEY : undefined;
  const actual = request.headers.get("x-api-key") ?? "";
  if (!expected || !actual || !equal(actual, expected)) {
    throw new Error("UNAUTHORIZED_SERVICE");
  }
}
