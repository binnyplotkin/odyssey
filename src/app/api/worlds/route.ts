import { NextResponse } from "next/server";
import { listWorlds } from "@/lib/simulation/service";

export async function GET() {
  const worlds = await listWorlds();
  return NextResponse.json({ worlds });
}
