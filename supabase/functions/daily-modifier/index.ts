// Supabase Edge Function (Deno): Serves the daily world condition (P6) to all players.
// Deploy: supabase functions deploy daily-modifier
// deno-lint-ignore-file no-explicit-any
// @ts-nocheck
import { createClient } from 'npm:@supabase/supabase-js@2';
import { resolveDailyModifier } from '../../../packages/director/src/daily.ts';

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

  const todayStr = new Date().toISOString().slice(0, 10);

  // 1. Check if today's modifier already exists in the table
  const { data: existing, error: selectErr } = await db
    .from('daily_modifiers')
    .select('day, modifier')
    .eq('day', todayStr)
    .maybeSingle();

  if (existing) {
    return json({ status: 'ok', source: 'db', day: existing.day, modifier: existing.modifier });
  }

  // 2. Fetch the last 7 modifiers to avoid repeats
  const { data: recentRows } = await db
    .from('daily_modifiers')
    .select('modifier')
    .order('day', { ascending: false })
    .limit(7);

  const lastSeven = (recentRows ?? []).map((r: any) => r.modifier?.modifier_id).filter(Boolean);

  // 3. Resolve today's modifier (with fallback guarantee)
  const result = await resolveDailyModifier(todayStr, lastSeven, null);

  // 4. Save to daily_modifiers table for all players today
  await db.from('daily_modifiers').upsert({
    day: todayStr,
    modifier: result.output,
  });

  return json({ status: 'ok', source: result.source, day: todayStr, modifier: result.output });
});
