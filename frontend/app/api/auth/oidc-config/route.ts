import { NextResponse } from "next/server";
import { getOidcRuntimeConfig } from "@/lib/oidc-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const config = await getOidcRuntimeConfig();
    return NextResponse.json(
      {
        enabled: Boolean(config),
        displayName: config?.displayName || "Single Sign-On",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to load public OIDC configuration:", error);
    return NextResponse.json(
      { enabled: false, displayName: "Single Sign-On" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }
}
