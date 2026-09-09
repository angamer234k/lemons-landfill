/**
 * Calls the site wall-mod API (approve / reject / reply / …).
 */
async function callSiteWallMod({ action, id, text }) {
  const modSecret = process.env.ONLINE_SECRET || process.env.WALL_MOD_SECRET;
  const siteBase = (process.env.SITE_URL || 'https://xn--e1aleee.space').replace(/\/$/, '');
  if (!modSecret) {
    throw new Error('ONLINE_SECRET / WALL_MOD_SECRET not set on bot');
  }
  const body = { password: modSecret, action, id };
  if (text != null) body.text = text;

  const r = await fetch(`${siteBase}/api/wall-mod`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `wall-mod ${r.status}`);
  return data;
}

module.exports = { callSiteWallMod };
