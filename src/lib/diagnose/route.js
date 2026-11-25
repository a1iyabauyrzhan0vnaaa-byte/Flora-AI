import { NextResponse } from "next/server";
import { diagnosePlant } from "@/lib/care";

export const runtime = "nodejs";
export const maxDuration = 30;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export async function POST(request) {
  let form;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, message: "multipart/form-data expected" }, { status: 400 });
  }
  const file = form.get("photo");
  if (!file || typeof file === "string") {
    return NextResponse.json({ ok: false, message: "photo missing" }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ ok: false, message: "File too large (max 10 MB)" }, { status: 400 });
  }
  const lang = ["kk", "ru", "en"].includes(form.get("lang")) ? form.get("lang") : "ru";
  const potCm = Math.max(5, Math.min(60, parseInt(form.get("pot_cm") || "15", 10) || 15));
  const buf = Buffer.from(await file.arrayBuffer());
  try {
    const result = await diagnosePlant({
      imageBase64: buf.toString("base64"),
      mimeType: file.type || "image/jpeg",
      lang,
      potCm,
    });
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    return NextResponse.json({ ok: false, message: err.message }, { status: 502 });
  }
}
