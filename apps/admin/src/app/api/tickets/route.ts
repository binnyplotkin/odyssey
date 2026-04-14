import { NextRequest, NextResponse } from "next/server";
import { getTicketStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

/* GET /api/tickets — list all tickets */
export async function GET() {
  try {
    const tickets = await getTicketStore().list();
    return NextResponse.json({ tickets });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to list tickets." },
      { status: 500 },
    );
  }
}

/* POST /api/tickets — create a ticket */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;

    if (!body.title || typeof body.title !== "string") {
      return NextResponse.json({ error: "title is required." }, { status: 400 });
    }
    if (!body.status || typeof body.status !== "string") {
      return NextResponse.json({ error: "status is required." }, { status: 400 });
    }

    const ticket = await getTicketStore().create({
      title: body.title,
      description: typeof body.description === "string" ? body.description : undefined,
      status: body.status,
      domain: typeof body.domain === "string" ? body.domain : undefined,
      priority: typeof body.priority === "string" ? body.priority : undefined,
      assignee: typeof body.assignee === "string" ? body.assignee : undefined,
      phase: typeof body.phase === "string" ? body.phase : undefined,
      featureId: typeof body.featureId === "string" ? body.featureId : undefined,
      startDate: typeof body.startDate === "string" ? body.startDate : undefined,
      endDate: typeof body.endDate === "string" ? body.endDate : undefined,
      subtasks: body.subtasks ?? undefined,
      activity: body.activity ?? undefined,
    });

    return NextResponse.json({ ticket }, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create ticket." },
      { status: 500 },
    );
  }
}
