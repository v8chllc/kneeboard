import { toNextJsHandler } from "better-auth/next-js";
import type { NextRequest } from "next/server";

import { getAuth } from "@/server/auth";

export const runtime = "nodejs";

export function GET(request: NextRequest) {
  return toNextJsHandler(getAuth()).GET(request);
}

export function POST(request: NextRequest) {
  return toNextJsHandler(getAuth()).POST(request);
}
