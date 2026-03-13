import { NextResponse } from "next/server";
import { listWorlds } from "@/lib/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const worlds = await listWorlds();
  return NextResponse.json({ worlds });
}
