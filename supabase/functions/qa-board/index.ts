// The historical QA board embedded a project credential and test data in a
// public Edge Function. Keep the deployed route closed. The authenticated QA
// board is served by the backend only when QA_BOARD_ENABLED=true.

Deno.serve(() =>
  new Response("Not found", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  })
);
