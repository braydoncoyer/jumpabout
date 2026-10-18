// Jumpabout Worker: serves the static game and a tiny public leaderboard API.
//   GET  /api/scores  -> top 10
//   POST /api/scores  -> { name, score, level, speed } -> { ok, rank, id, top }
// There is no login, so submissions are sanity-checked and rate limited
// rather than trusted.

const TOP_N = 10;
const NAME_RE = /^[A-Z0-9 .!-]{3}$/;
const BLOCKED = new Set(['ASS', 'FUK', 'FUC', 'FCK', 'CUM', 'COK', 'DIK', 'DIC', 'FAG', 'NIG', 'KKK', 'SEX', 'TIT', 'JIZ', 'GAY', 'CNT', 'KUM', 'NAZ', 'XXX']);
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 3;

// Highest score one level can plausibly yield: 16 bombs, a full 2500 time bonus,
// the 1000-point Spellbound bonus and generous Jumpman bonuses (up to 300 each).
const MAX_PER_LEVEL = 1600 + 2500 + 1000 + 300 * 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/scores') {
      try {
        if (request.method === 'GET') return json({ top: await top(env) });
        if (request.method === 'POST') return await submit(request, env);
        return json({ error: 'method not allowed' }, 405);
      } catch (e) {
        return json({ error: 'server error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  }
};

async function top(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, score, level, speed, created_at FROM scores ORDER BY score DESC, created_at ASC LIMIT ?'
  ).bind(TOP_N).all();
  return results;
}

async function submit(request, env) {
  let body;
  try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400); }

  const name = String(body.name || '').toUpperCase();
  const score = Number(body.score), level = Number(body.level), speed = Number(body.speed);

  if (!NAME_RE.test(name) || BLOCKED.has(name.replace(/[^A-Z]/g, ''))) return json({ error: 'name not allowed' }, 400);
  if (!Number.isInteger(level) || level < 1 || level > 999) return json({ error: 'bad level' }, 400);
  if (!Number.isInteger(speed) || speed < 1 || speed > 8) return json({ error: 'bad speed' }, 400);
  // every score source in the game is a multiple of 25
  if (!Number.isInteger(score) || score <= 0 || score % 25 !== 0 || score > level * MAX_PER_LEVEL) {
    return json({ error: 'score not plausible' }, 400);
  }

  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const ipHash = await sha256((env.IP_SALT || 'jumpabout') + ':' + ip);
  const now = Date.now();
  const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE ip_hash = ? AND created_at > ?')
    .bind(ipHash, now - RATE_WINDOW_MS).first();
  if (recent && recent.n >= RATE_MAX) return json({ error: 'slow down' }, 429);

  const res = await env.DB.prepare('INSERT INTO scores (name, score, level, speed, ip_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(name, score, level, speed, ipHash, now).run();
  const id = res.meta.last_row_id;
  const better = await env.DB.prepare('SELECT COUNT(*) AS n FROM scores WHERE score > ? OR (score = ? AND created_at < ?)')
    .bind(score, score, now).first();

  return json({ ok: true, id, rank: better.n + 1, top: await top(env) });
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
  });
}
