import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

type Json = Record<string, unknown>;

function jsonResponse(body: Json, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

function base64ToBytes(base64: string): Uint8Array {
  const raw = base64.includes(",") ? base64.split(",").pop() || "" : base64;
  const bin = atob(raw);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
  return bytes;
}

type Kind = "business_license" | "tax_id" | "venue_photo";

const KIND_TO_FOLDER: Record<Kind, string> = {
  business_license: "business-license",
  tax_id: "tax-id",
  venue_photo: "venue-photo",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return jsonResponse({ ok: true });
  if (req.method !== "POST") return jsonResponse({ ok: false, error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (missing.length) {
    return jsonResponse({ ok: false, error: `Missing env vars: ${missing.join(", ")}` }, 500);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.toLowerCase().startsWith("bearer ") ? authHeader.slice(7).trim() : authHeader.trim();
  if (!jwt) return jsonResponse({ ok: false, error: "Unauthorized" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await userClient.auth.getUser(jwt);
  if (userError || !userData?.user) {
    return jsonResponse({ ok: false, error: userError?.message || "Unauthorized" }, 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON" }, 400);
  }

  const action = String(body?.action || "upload").toLowerCase();

  if (action === "sign") {
    const path = typeof body?.path === "string" ? body.path.trim() : "";
    const expiresInSecondsRaw = Number(body?.expiresInSeconds ?? 600);
    const expiresInSeconds = Number.isFinite(expiresInSecondsRaw)
      ? Math.max(60, Math.min(60 * 60, Math.floor(expiresInSecondsRaw)))
      : 600;

    if (!path) return jsonResponse({ ok: false, error: "Missing path" }, 400);

    const userId = userData.user.id;
    const { data: profile, error: profileError } = await serviceClient
      .from("profiles")
      .select("id, role")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) return jsonResponse({ ok: false, error: "Failed to load profile" }, 500);
    if (!profile?.id) return jsonResponse({ ok: false, error: "Profile not found" }, 404);

    const role = String(profile.role || "").toLowerCase();
    const isAdmin = role === "admin";
    if (!isAdmin) {
      const prefix = `${userId}/`;
      if (!path.startsWith(prefix)) return jsonResponse({ ok: false, error: "Not allowed" }, 403);
    }

    const { data, error } = await serviceClient.storage
      .from("organizer_verification")
      .createSignedUrl(path, expiresInSeconds);
    if (error || !data?.signedUrl) {
      const msg = String((error as any)?.message || error || "Failed to create signed url");
      return jsonResponse({ ok: false, error: msg }, 500);
    }

    return jsonResponse({ signedUrl: data.signedUrl });
  }

  const kind = String(body?.kind || "") as Kind;
  const mimeType = String(body?.mimeType || "");
  const fileName = typeof body?.fileName === "string" ? body.fileName : "";
  const base64 = typeof body?.base64 === "string" ? body.base64 : "";

  if (kind !== "business_license" && kind !== "tax_id" && kind !== "venue_photo") {
    return jsonResponse({ ok: false, error: "Invalid kind" }, 400);
  }

  const allowedMimeTypes =
    kind === "venue_photo"
      ? ["image/png", "image/jpeg", "image/webp"]
      : ["application/pdf", "image/png", "image/jpeg", "image/webp"];

  const safeMimeType = mimeType || "application/octet-stream";
  if (!allowedMimeTypes.includes(safeMimeType)) {
    return jsonResponse({ ok: false, error: "Invalid mime type" }, 400);
  }

  const bytes = base64 ? base64ToBytes(base64) : new Uint8Array();
  if (!bytes.length) {
    return jsonResponse({ ok: false, error: "Missing file data" }, 400);
  }
  if (bytes.length > 10 * 1024 * 1024) {
    return jsonResponse({ ok: false, error: "File too large" }, 413);
  }

  const userId = userData.user.id;
  const { data: profile, error: profileError } = await serviceClient
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) return jsonResponse({ ok: false, error: "Failed to load profile" }, 500);
  if (!profile?.id) return jsonResponse({ ok: false, error: "Profile not found" }, 404);
  if (profile.role !== "organizer" && profile.role !== "admin") return jsonResponse({ ok: false, error: "Not allowed" }, 403);

  const nameExt = fileName.split(".").pop()?.toLowerCase() || "";
  const ext =
    nameExt && nameExt.length <= 8
      ? nameExt
      : safeMimeType === "application/pdf"
        ? "pdf"
        : safeMimeType === "image/png"
          ? "png"
          : safeMimeType === "image/webp"
            ? "webp"
            : "jpg";

  const random = crypto.randomUUID().split("-").slice(0, 2).join("");
  const path = `${userId}/${KIND_TO_FOLDER[kind]}/${Date.now()}-${random}.${ext}`;

  const { error: uploadError } = await serviceClient.storage.from("organizer_verification").upload(path, bytes, {
    contentType: safeMimeType,
    upsert: true,
  });

  if (uploadError) {
    const msg = String((uploadError as any)?.message || uploadError);
    if (msg.toLowerCase().includes("bucket") && msg.toLowerCase().includes("not found")) {
      return jsonResponse({ ok: false, error: "Bucket organizer_verification not found" }, 500);
    }
    return jsonResponse({ ok: false, error: msg || "Upload failed" }, 500);
  }

  return jsonResponse({ path, contentType: safeMimeType });
});
