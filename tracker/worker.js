/**
 * Gospel System : suivi d'usage (Cloudflare Worker + base D1).
 *
 *   POST /e            envoi d'événements par l'app (clé d'envoi INGEST_KEY, publique dans l'app)
 *   GET  /stats        statistiques pour Réglages > Utilisation (clé d'administration ADMIN_KEY)
 *   GET  /export.csv   historique complet (clé d'administration)
 *
 * Données : identifiant du membre, date, type d'événement, type d'appareil. Ni adresse IP, ni localisation.
 * Conservation : 24 mois (purge automatique).
 *
 * Liaisons à configurer : DB (base D1), INGEST_KEY, ADMIN_KEY (secrets), ALLOWED_ORIGIN (variable).
 */

export const ID_RE = /^[a-z0-9._-]{2,32}$/;
export const TYPES = ['open', 'login', 'activate'];
const DAY = 86_400_000;
export const RETENTION_DAYS = 730;
const MAX_BATCH = 50;
const MAX_BODY = 16_000;

const short = (v, n) => String(v ?? '').replace(/[^A-Za-z0-9 .+_-]/g, '').slice(0, n);

/** Valide et nettoie un événement reçu ; null si invalide. Les événements en file d'attente (hors ligne) peuvent avoir jusqu'à 31 jours. */
export function cleanEvent(e, now = Date.now()) {
  if (!e || typeof e !== 'object') return null;
  const member = String(e.member ?? '').trim().toLowerCase();
  if (!ID_RE.test(member) || !TYPES.includes(e.type)) return null;
  const ts = Math.trunc(Number(e.ts));
  if (!Number.isFinite(ts) || ts < now - 31 * DAY || ts > now + 3_600_000) return null;
  return { member, type: e.type, ts, os: short(e.os, 20), browser: short(e.browser, 20), standalone: e.standalone ? 1 : 0, ver: short(e.ver, 16) };
}

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

const isAdmin = (req, env) => safeEqual((req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, ''), env.ADMIN_KEY ?? '');

function cors(req, env) {
  const allowed = env.ALLOWED_ORIGIN || '';
  const origin = req.headers.get('Origin') || '';
  // Un navigateur envoie toujours Origin pour une requête d'un autre site ; sans Origin (adresse ouverte à la main, curl) la clé reste exigée
  const ok = !allowed || !origin || origin === allowed;
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': allowed || '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

const json = (data, status, headers) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const csvCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

async function ingest(req, env, h) {
  const text = await req.text();
  if (text.length > MAX_BODY) return json({ error: 'trop volumineux' }, 413, h);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'JSON invalide' }, 400, h); }
  if (!safeEqual(String(body?.k ?? ''), env.INGEST_KEY ?? '')) return json({ error: 'clé refusée' }, 401, h);
  const now = Date.now();
  const events = (Array.isArray(body.ev) ? body.ev.slice(0, MAX_BATCH) : []).map((e) => cleanEvent(e, now)).filter(Boolean);
  if (events.length) {
    const stmt = env.DB.prepare('INSERT OR IGNORE INTO events (member, type, ts, os, browser, standalone, ver) VALUES (?, ?, ?, ?, ?, ?, ?)');
    await env.DB.batch(events.map((e) => stmt.bind(e.member, e.type, e.ts, e.os, e.browser, e.standalone, e.ver)));
  }
  // Purge opportuniste (24 mois), sans tâche planifiée
  if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM events WHERE ts < ?').bind(now - RETENTION_DAYS * DAY).run();
  return json({ ok: true, accepted: events.length, received: Array.isArray(body.ev) ? Math.min(body.ev.length, MAX_BATCH) : 0 }, 200, h);
}

export async function stats(env, daysParam, tzParam, now = Date.now()) {
  const days = Math.min(RETENTION_DAYS, Math.max(1, Math.trunc(Number(daysParam)) || 30));
  const tz = Math.min(840, Math.max(-720, Math.trunc(Number(tzParam)) || 0)); // minutes d'avance sur UTC
  const since = now - days * DAY;
  const t7 = now - 7 * DAY;
  const t30 = now - 30 * DAY;
  const all = async (sql, ...args) => (await env.DB.prepare(sql).bind(...args).all()).results ?? [];

  const daily = await all(
    `SELECT date((ts / 1000) + ? * 60, 'unixepoch') AS d,
            SUM(type = 'open') AS opens, SUM(type IN ('login', 'activate')) AS logins,
            COUNT(DISTINCT CASE WHEN type = 'open' THEN member END) AS members
       FROM events WHERE ts >= ? GROUP BY d ORDER BY d`, tz, since);
  const members = await all(
    `SELECT member,
            SUM(type = 'open') AS opens, SUM(type = 'login') AS logins, SUM(type = 'activate') AS activations,
            SUM(type = 'open' AND ts >= ?) AS opens7, SUM(type = 'open' AND ts >= ?) AS opens30,
            SUM(type = 'login' AND ts >= ?) AS logins30,
            MIN(ts) AS first,
            MAX(CASE WHEN type = 'open' THEN ts END) AS lastOpen,
            MAX(CASE WHEN type = 'login' THEN ts END) AS lastLogin
       FROM events GROUP BY member ORDER BY member`, t7, t30, t30);
  const devices = await all(
    `SELECT member, os, browser, standalone, COUNT(*) AS n FROM events WHERE type = 'open'
      GROUP BY member, os, browser, standalone ORDER BY n DESC`);
  const totals = (await all(
    `SELECT SUM(type = 'open') AS opens, SUM(type = 'login') AS logins, SUM(type = 'activate') AS activations,
            COUNT(DISTINCT CASE WHEN type = 'open' AND ts >= ? THEN member END) AS active7,
            COUNT(DISTINCT CASE WHEN type = 'open' AND ts >= ? THEN member END) AS active30,
            MIN(ts) AS since
       FROM events WHERE ts >= ?`, t7, t30, since))[0] ?? {};
  return { days, tz, now, totals, daily, members, devices };
}

async function exportCsv(env) {
  const rows = (await env.DB.prepare('SELECT ts, member, type, os, browser, standalone, ver FROM events ORDER BY ts LIMIT 200000').all()).results ?? [];
  const head = 'date_utc,membre,type,systeme,navigateur,app_installee,version';
  const lines = rows.map((r) => [new Date(r.ts).toISOString(), r.member, r.type, r.os, r.browser, r.standalone ? 'oui' : 'non', r.ver].map(csvCell).join(','));
  return [head, ...lines].join('\n') + '\n';
}

export default {
  async fetch(req, env) {
    const c = cors(req, env);
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
    if (!c.ok) return json({ error: 'origine refusée' }, 403, c.headers);
    try {
      if (req.method === 'POST' && url.pathname === '/e') return await ingest(req, env, c.headers);
      if (req.method === 'GET' && (url.pathname === '/stats' || url.pathname === '/export.csv')) {
        if (!isAdmin(req, env)) return json({ error: 'clé d\'administration refusée' }, 401, c.headers);
        if (url.pathname === '/stats') return json(await stats(env, url.searchParams.get('days'), url.searchParams.get('tz')), 200, c.headers);
        return new Response(await exportCsv(env), { status: 200, headers: { ...c.headers, 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="gospel-system-usage.csv"' } });
      }
      if (req.method === 'GET' && url.pathname === '/') return new Response('Gospel System usage tracker : OK', { headers: c.headers });
      return json({ error: 'introuvable' }, 404, c.headers);
    } catch (e) {
      return json({ error: 'erreur serveur' }, 500, c.headers);
    }
  },
};
