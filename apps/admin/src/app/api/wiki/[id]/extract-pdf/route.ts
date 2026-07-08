import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Extract plain text from an uploaded PDF so the ingestion composer can treat a
 * PDF the same as pasted text. Multipart POST (`file`) → { text, pages, chars }.
 * Extraction runs in Node via `unpdf` (no worker/canvas needed).
 */
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return jsonError(400, "expected multipart/form-data with a `file` field");
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return jsonError(400, "invalid form data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return jsonError(400, "`file` field is required");
  }
  if (file.type && file.type !== "application/pdf") {
    return jsonError(415, `unsupported file type "${file.type}" — PDF only`);
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch {
    return jsonError(400, "could not read uploaded file");
  }

  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text, totalPages } = await extractText(pdf, { mergePages: true });
    const normalized = normalizeExtractedText(text);
    if (!normalized) {
      return jsonError(
        422,
        "no extractable text — this PDF may be scanned/image-only",
      );
    }
    return Response.json(
      {
        text: normalized,
        pages: totalPages,
        chars: normalized.length,
        filename: file.name,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonError(500, `failed to parse PDF: ${message}`);
  }
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
