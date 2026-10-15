import { NextResponse } from "next/server";
import type { NextFetchEvent, NextMiddleware, NextRequest } from "next/server";
import { auth } from "@/auth";

// Page-level authorization remains responsible for company and role permissions.
const authenticatedProxy = auth((request) => {
  if (!request.auth?.user?.id && request.method === "GET") {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("returnTo", request.nextUrl.pathname + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
});

export async function proxy(request: NextRequest, event: NextFetchEvent) {
  // Auth.js lazy configuration returns this wrapper asynchronously at runtime.
  const handler = await authenticatedProxy as unknown as NextMiddleware;
  return handler(request, event);
}

export const config = { matcher: ["/account/:path*", "/company/:path*", "/admin/:path*"] };
