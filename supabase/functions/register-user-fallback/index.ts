const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Retired: this historical development fallback created email-confirmed users
// with the service role. Registration must always use Supabase Auth signUp so
// email verification, abuse controls and Auth hooks remain authoritative.
Deno.serve((req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: false, error: "Endpoint retired" }), {
    status: 410,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
});
