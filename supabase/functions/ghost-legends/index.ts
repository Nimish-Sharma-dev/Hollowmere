// Supabase Edge Function (Deno): Serves and stores asynchronous Ghost Legends (P7a) across player runs.
// Deploy: supabase functions deploy ghost-legends
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const db = createClient(url, serviceKey);

  if (req.method === 'GET') {
    // Fetch recent ghost legends to populate monuments in a new run
    const { data: rows, error } = await db
      .from('ghost_legends')
      .select('id, run_id, legend_text, tags, monument_type, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) return json({ status: 'error', detail: error.message }, 500);
    return json({ status: 'ok', legends: rows ?? [] });
  }

  if (req.method === 'POST') {
    // Record a new legend at the end of a run
    const body = await req.json();
    const { runId, legendText, tags, monumentType } = body;

    if (!legendText || !monumentType) {
      return json({ status: 'error', detail: 'missing required fields' }, 400);
    }

    const { data: inserted, error } = await db
      .from('ghost_legends')
      .insert({
        run_id: runId ?? null,
        legend_text: legendText,
        tags: tags ?? {},
        monument_type: monumentType,
      })
      .select()
      .single();

    if (error) return json({ status: 'error', detail: error.message }, 500);
    return json({ status: 'ok', inserted });
  }

  return json({ status: 'error', detail: 'method not allowed' }, 405);
});
