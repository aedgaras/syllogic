import { NextResponse } from "next/server";
import { getRegistrationStatus } from "@/lib/registration-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const status = await getRegistrationStatus();
    return NextResponse.json(
      {
        enabled: status.enabled,
        firstUserWillBeAdmin: status.firstUserWillBeAdmin,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    console.error("Failed to load registration configuration:", error);
    return NextResponse.json(
      { enabled: false, firstUserWillBeAdmin: false },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
}
