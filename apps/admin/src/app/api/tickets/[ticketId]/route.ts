import { NextRequest, NextResponse } from "next/server";
import { getTicketStore } from "@odyssey/db";

export const dynamic = "force-dynamic";

type RouteParams = { params: Promise<{ ticketId: string }> };

/* GET /api/tickets/:id */
export async function GET(_request: Request, { params }: RouteParams) {
  try {
    const { ticketId } = await params;
    const ticket = await getTicketStore().getById(ticketId);

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load ticket." },
      { status: 500 },
    );
  }
}

/* PATCH /api/tickets/:id — partial update */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { ticketId } = await params;
    const body = (await request.json()) as Record<string, unknown>;

    const ticket = await getTicketStore().update(ticketId, {
      ...(typeof body.title === "string" && { title: body.title }),
      ...(typeof body.description === "string" && { description: body.description }),
      ...(body.description === null && { description: null }),
      ...(typeof body.status === "string" && { status: body.status }),
      ...(typeof body.domain === "string" && { domain: body.domain }),
      ...(body.domain === null && { domain: null }),
      ...(typeof body.priority === "string" && { priority: body.priority }),
      ...(body.priority === null && { priority: null }),
      ...(typeof body.assignee === "string" && { assignee: body.assignee }),
      ...(body.assignee === null && { assignee: null }),
      ...(typeof body.phase === "string" && { phase: body.phase }),
      ...(body.phase === null && { phase: null }),
      ...(typeof body.featureId === "string" && { featureId: body.featureId }),
      ...(body.featureId === null && { featureId: null }),
      ...(typeof body.startDate === "string" && { startDate: body.startDate }),
      ...(body.startDate === null && { startDate: null }),
      ...(typeof body.endDate === "string" && { endDate: body.endDate }),
      ...(body.endDate === null && { endDate: null }),
      ...(body.subtasks !== undefined && { subtasks: body.subtasks }),
      ...(body.activity !== undefined && { activity: body.activity }),
    });

    if (!ticket) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    return NextResponse.json({ ticket });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update ticket." },
      { status: 500 },
    );
  }
}

/* DELETE /api/tickets/:id */
export async function DELETE(_request: Request, { params }: RouteParams) {
  try {
    const { ticketId } = await params;
    const removed = await getTicketStore().remove(ticketId);

    if (!removed) {
      return NextResponse.json({ error: "Ticket not found." }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to delete ticket." },
      { status: 500 },
    );
  }
}
