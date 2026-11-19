import { NextResponse } from "next/server";
import { ApiError, route } from "../../../../../../lib/api-v1";
import { attachPdfFile } from "../../../../../../lib/attach-file";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = route<{ params: Promise<{ id: string }> }>(async (request, context) => {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.type !== "application/pdf") throw new ApiError(400, "invalid", "A PDF file is required.");
  return NextResponse.json(await attachPdfFile((await context.params).id, file), { status: 201 });
});
