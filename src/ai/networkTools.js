const net = require('net');
const dns = require('dns').promises;
const tls = require('tls');
const { URL } = require('url');

const HTTP_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; lemonAI-bot/1.1; +https://github.com/angamer234k/lemons-landfill)';

const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV', 'PTR'];

const networkToolDefs = [
  {
    type: 'function',
    function: {
      name: 'dns_lookup',
      description:
        'Look up DNS records for a hostname. Supports A, AAAA, MX, TXT, NS, CNAME, SOA, CAA, SRV, PTR, or ALL. Use for domain diagnostics, mail setup, and record checks.',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Hostname or domain, e.g. example.com' },
          type: {
            type: 'string',
            description: 'Record type, or ALL for a bundle of common types',
            enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV', 'PTR', 'ALL'],
          },
        },
        required: ['host'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'reverse_dns',
      description: 'Reverse-DNS (PTR) lookup for a public IP address.',
      parameters: {
        type: 'object',
        properties: { ip: { type: 'string', description: 'IPv4 or IPv6 address' } },
        required: ['ip'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'whois_lookup',
      description:
        'RDAP/WHOIS-style lookup for a public domain or IP: registrar, status, nameservers, registration/expiry dates, ASN/network (for IPs).',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'Domain (example.com) or public IP' } },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ssl_inspect',
      description:
        'Inspect a TLS certificate: subject, SAN, issuer, validity, fingerprint, protocol, cipher, and whether the handshake is trusted.',
      parameters: {
        type: 'object',
        properties: {
          host: { type: 'string', description: 'Hostname, e.g. example.com' },
          port: { type: 'integer', description: 'TLS port, default 443', minimum: 1, maximum: 65535 },
        },
        required: ['host'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'ip_info',
      description:
        'IP geolocation and network info: country, city, ISP, ASN, timezone, coordinates. Accepts a public IP or hostname (resolved first).',
      parameters: {
        type: 'object',
        properties: { target: { type: 'string', description: 'Public IP or hostname' } },
        required: ['target'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_probe',
      description:
        'Probe a public HTTP(S) URL: status, timing, final URL, server, and security-header analysis (HSTS, CSP, X-Frame-Options, etc.). Does not return the body.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Full URL including https://' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'redirect_trace',
      description: 'Follow HTTP redirects (up to 10 hops) and return the chain of URLs and status codes. Useful for short links.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Starting URL' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'website_up',
      description: 'Check whether a public website is reachable. Returns up/down, HTTP status, and latency.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Website URL or hostname' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'email_dns',
      description:
        'Inspect mail-related DNS for a domain: MX hosts, SPF, DMARC, and NS. Use when debugging email delivery or spoofing protections.',
      parameters: {
        type: 'object',
        properties: { domain: { type: 'string', description: 'Email domain, e.g. example.com' } },
        required: ['domain'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'cidr_info',
      description:
        'Explain an IPv4 CIDR block locally (no scanning): netmask, network, broadcast, usable range, and host count.',
      parameters: {
        type: 'object',
        properties: { cidr: { type: 'string', description: 'CIDR notation, e.g. 192.0.2.0/24' } },
        required: ['cidr'],
      },
    },
  },
];

function ipv4ToInt(ip) {
  const p = ip.split('.').map(n => Number(n));
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return (((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3]) >>> 0;
}

function intToIpv4(n) {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) {
    const n = ipv4ToInt(ip);
    if (n == null) return true;
    const ranges = [
      [0x00000000, 0xff000000], // 0.0.0.0/8
      [0x0a000000, 0xff000000], // 10.0.0.0/8
      [0x7f000000, 0xff000000], // 127.0.0.0/8
      [0xa9fe0000, 0xffff0000], // 169.254.0.0/16
      [0xac100000, 0xfff00000], // 172.16.0.0/12
      [0xc0a80000, 0xffff0000], // 192.168.0.0/16
      [0x64400000, 0xffc00000], // 100.64.0.0/10
      [0xe0000000, 0xf0000000], // 224.0.0.0/4
      [0xf0000000, 0xf0000000], // 240.0.0.0/4
    ];
    return ranges.some(([base, mask]) => ((n & mask) >>> 0) === (base >>> 0));
  }
  if (net.isIP(ip) === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true;
    if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
    if (lower.startsWith('fe80')) return true;
    if (lower.startsWith('ff')) return true;
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) return isPrivateIp(mapped[1]);
    return false;
  }
  return true;
}

function isBlockedHostname(host) {
  const h = String(host || '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '');
  if (!h) return true;
  if (h === 'localhost' || h === 'localhost.localdomain') return true;
  if (h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.lan')) return true;
  if (h === 'metadata.google.internal' || h.endsWith('.metadata.google.internal')) return true;
  return false;
}

async function assertPublicHost(host) {
  const h = String(host || '')
    .trim()
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .replace(/\.$/, '');
  if (!h) throw new Error('host is required');
  if (isBlockedHostname(h)) throw new Error('Private/local hosts are not allowed');
  if (net.isIP(h)) {
    if (isPrivateIp(h)) throw new Error('Private/reserved IP addresses are not allowed');
    return h;
  }
  let addrs;
  try {
    addrs = await dns.lookup(h, { all: true });
  } catch (err) {
    throw new Error(`DNS lookup failed: ${err.message}`);
  }
  if (!addrs.length) throw new Error('DNS lookup returned no addresses');
  for (const a of addrs) {
    if (isPrivateIp(a.address)) {
      throw new Error(`Host resolves to a private/reserved address (${a.address})`);
    }
  }
  return h;
}

function parseHttpUrl(raw) {
  let url = String(raw || '').trim();
  if (!url) throw new Error('url is required');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error('Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http and https URLs are allowed');
  }
  return parsed;
}

async function fetchWithTimeout(url, options = {}, ms = HTTP_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function resolveDnsType(host, type) {
  const t = type.toUpperCase();
  try {
    switch (t) {
      case 'A':
        return await dns.resolve4(host);
      case 'AAAA':
        return await dns.resolve6(host);
      case 'MX':
        return (await dns.resolveMx(host)).sort((a, b) => a.priority - b.priority);
      case 'TXT':
        return (await dns.resolveTxt(host)).map(parts => parts.join(''));
      case 'NS':
        return await dns.resolveNs(host);
      case 'CNAME':
        return await dns.resolveCname(host);
      case 'SOA':
        return await dns.resolveSoa(host);
      case 'CAA':
        return await dns.resolveCaa(host);
      case 'SRV':
        return await dns.resolveSrv(host);
      case 'PTR':
        return await dns.resolvePtr(host);
      default:
        return { error: `Unsupported type ${t}` };
    }
  } catch (err) {
    const code = err.code || '';
    if (code === 'ENODATA' || code === 'ENOTFOUND' || code === 'NODATA') return [];
    return { error: err.message, code: code || undefined };
  }
}

async function dnsLookup(args) {
  let host = String(args.host || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/:\d+$/, '');
  if (!host) return { ok: false, error: 'host is required' };
  try {
    await assertPublicHost(host);
  } catch (err) {
    return { ok: false, error: err.message, host };
  }

  const type = String(args.type || 'ALL').toUpperCase();
  const types = type === 'ALL' ? ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA'] : [type];
  if (type !== 'ALL' && !DNS_TYPES.includes(type)) {
    return { ok: false, error: `Unsupported type. Use one of: ${DNS_TYPES.join(', ')}, ALL` };
  }

  const records = {};
  await Promise.all(
    types.map(async t => {
      records[t] = await resolveDnsType(host, t);
    })
  );
  return { ok: true, host, type: type === 'ALL' ? 'ALL' : type, records };
}

async function reverseDns(args) {
  const ip = String(args.ip || args.host || '').trim();
  if (!ip) return { ok: false, error: 'ip is required' };
  if (!net.isIP(ip)) return { ok: false, error: 'Not a valid IP address' };
  try {
    await assertPublicHost(ip);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  try {
    const names = await dns.reverse(ip);
    return { ok: true, ip, ptr: names };
  } catch (err) {
    return { ok: false, error: err.message, ip };
  }
}

function summarizeRdap(data, kind) {
  const events = {};
  for (const ev of data.events || []) {
    if (ev.eventAction && ev.eventDate) events[ev.eventAction] = ev.eventDate;
  }
  const entities = (data.entities || []).slice(0, 8).map(e => ({
    roles: e.roles || [],
    handle: e.handle || null,
    name:
      e.vcardArray && Array.isArray(e.vcardArray[1])
        ? (e.vcardArray[1].find(x => x[0] === 'fn') || [])[3] || null
        : null,
  }));
  const out = {
    kind,
    handle: data.handle || null,
    name: data.ldhName || data.name || data.handle || null,
    status: data.status || [],
    events,
    entities,
  };
  if (data.nameservers) {
    out.nameservers = data.nameservers.map(ns => ns.ldhName || ns.unicodeName || ns).filter(Boolean);
  }
  if (data.secureDNS) {
    out.dnssec = {
      enabled: !!data.secureDNS.delegationSigned,
      ds: Array.isArray(data.secureDNS.dsData) ? data.secureDNS.dsData.length : 0,
    };
  }
  if (data.unicodeName) out.unicodeName = data.unicodeName;
  if (data.startAddress) {
    out.network = {
      start: data.startAddress,
      end: data.endAddress,
      cidr: Array.isArray(data.cidr0_cidrs)
        ? data.cidr0_cidrs.map(c => `${c.v4prefix || c.v6prefix}/${c.length}`).join(', ')
        : data.handle,
      name: data.name,
      type: data.type,
      country: data.country,
    };
  }
  return out;
}

async function whoisLookup(args) {
  let query = String(args.query || args.host || args.domain || '').trim();
  if (!query) return { ok: false, error: 'query is required' };
  query = query.replace(/^https?:\/\//i, '').split('/')[0];

  const isIp = !!net.isIP(query);
  try {
    await assertPublicHost(query);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const url = isIp
    ? `https://rdap.org/ip/${encodeURIComponent(query)}`
    : `https://rdap.org/domain/${encodeURIComponent(query)}`;

  try {
    const res = await fetchWithTimeout(url, { headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': UA } });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return {
        ok: false,
        error: `RDAP HTTP ${res.status}`,
        detail: text.slice(0, 300),
        query,
      };
    }
    const data = await res.json();
    return { ok: true, query, rdap: summarizeRdap(data, isIp ? 'ip' : 'domain') };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
    return { ok: false, error: msg, query };
  }
}

function sslInspect(args) {
  return new Promise(async resolve => {
    let host = String(args.host || '')
      .trim()
      .replace(/^https?:\/\//i, '')
      .split('/')[0];
    let port = args.port != null ? Number(args.port) : 443;
    if (host.includes(':') && !host.startsWith('[') && !net.isIP(host)) {
      const parts = host.split(':');
      if (parts.length === 2 && /^\d+$/.test(parts[1])) {
        host = parts[0];
        if (args.port == null) port = Number(parts[1]);
      }
    }
    if (!host) return resolve({ ok: false, error: 'host is required' });
    if (!Number.isFinite(port) || port < 1 || port > 65535) port = 443;

    try {
      await assertPublicHost(host);
    } catch (err) {
      return resolve({ ok: false, error: err.message, host });
    }

    const sock = tls.connect(
      {
        host,
        port,
        servername: net.isIP(host) ? undefined : host,
        rejectUnauthorized: false,
        ALPNProtocols: ['h2', 'http/1.1'],
      },
      () => {
        const cert = sock.getPeerCertificate();
        const cipher = sock.getCipher();
        let daysLeft = null;
        try {
          const until = new Date(cert.valid_to).getTime();
          daysLeft = Math.round((until - Date.now()) / 86400000);
        } catch {
          /* ignore */
        }
        const info = {
          ok: true,
          host,
          port,
          authorized: sock.authorized,
          authorizationError: sock.authorizationError || null,
          protocol: sock.getProtocol(),
          alpn: sock.alpnProtocol || null,
          cipher: cipher ? { name: cipher.name, version: cipher.version } : null,
          subject: cert.subject || null,
          issuer: cert.issuer || null,
          valid_from: cert.valid_from || null,
          valid_to: cert.valid_to || null,
          days_until_expiry: daysLeft,
          serialNumber: cert.serialNumber || null,
          fingerprint256: cert.fingerprint256 || null,
          subjectaltname: cert.subjectaltname || null,
        };
        sock.end();
        resolve(info);
      }
    );
    sock.setTimeout(HTTP_TIMEOUT_MS, () => {
      sock.destroy();
      resolve({ ok: false, error: `TLS handshake timed out after ${HTTP_TIMEOUT_MS}ms`, host, port });
    });
    sock.on('error', err => {
      sock.destroy();
      resolve({ ok: false, error: err.message, host, port });
    });
  });
}

async function ipInfo(args) {
  let target = String(args.target || args.ip || args.host || '').trim();
  if (!target) return { ok: false, error: 'target is required' };
  target = target.replace(/^https?:\/\//i, '').split('/')[0].replace(/:\d+$/, '');

  try {
    await assertPublicHost(target);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  let ip = target;
  if (!net.isIP(target)) {
    try {
      const r = await dns.lookup(target);
      ip = r.address;
    } catch (err) {
      return { ok: false, error: `Could not resolve host: ${err.message}` };
    }
  }

  try {
    const res = await fetchWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
    });
    if (!res.ok) return { ok: false, error: `ipwho.is HTTP ${res.status}`, ip };
    const data = await res.json();
    if (data.success === false) return { ok: false, error: data.message || 'lookup failed', ip };
    return {
      ok: true,
      queried: target,
      ip: data.ip,
      type: data.type,
      continent: data.continent,
      country: data.country,
      country_code: data.country_code,
      region: data.region,
      city: data.city,
      postal: data.postal,
      latitude: data.latitude,
      longitude: data.longitude,
      timezone: data.timezone?.id || data.timezone,
      isp: data.connection?.isp,
      org: data.connection?.org,
      asn: data.connection?.asn,
      domain: data.connection?.domain,
    };
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
    return { ok: false, error: msg, ip };
  }
}

const SECURITY_HEADER_KEYS = [
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cross-origin-resource-policy',
  'cross-origin-embedder-policy',
  'access-control-allow-origin',
  'set-cookie',
  'server',
  'x-powered-by',
  'expect-ct',
  'nel',
  'report-to',
];

function analyzeSecurityHeaders(headers) {
  const get = k => headers.get(k);
  const present = {};
  for (const k of SECURITY_HEADER_KEYS) {
    const v = get(k);
    if (v) present[k] = v.length > 400 ? v.slice(0, 400) + '…' : v;
  }
  const missing = [];
  if (!get('strict-transport-security')) missing.push('strict-transport-security');
  if (!get('content-security-policy')) missing.push('content-security-policy');
  if (!get('x-frame-options') && !(get('content-security-policy') || '').toLowerCase().includes('frame-ancestors')) {
    missing.push('x-frame-options (or CSP frame-ancestors)');
  }
  if (!get('x-content-type-options')) missing.push('x-content-type-options');
  if (!get('referrer-policy')) missing.push('referrer-policy');
  if (get('x-powered-by')) missing.push('(info) x-powered-by exposes stack');
  if (get('server') && /nginx|apache|iis|express|cloudflare/i.test(get('server'))) {
    /* informational, not missing */
  }
  return { headers: present, notes: missing };
}

async function httpProbe(args) {
  let parsed;
  try {
    parsed = parseHttpUrl(args.url);
    await assertPublicHost(parsed.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const started = Date.now();
  try {
    let res = await fetchWithTimeout(
      parsed.href,
      { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' } },
      HTTP_TIMEOUT_MS
    );
    let method = 'HEAD';
    if (res.status === 405 || res.status === 501) {
      res = await fetchWithTimeout(
        parsed.href,
        { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' } },
        HTTP_TIMEOUT_MS
      );
      method = 'GET';
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
    }
    const elapsed_ms = Date.now() - started;
    const sec = analyzeSecurityHeaders(res.headers);
    return {
      ok: true,
      requested: parsed.href,
      final_url: res.url || parsed.href,
      method,
      status: res.status,
      statusText: res.statusText,
      redirected: res.redirected,
      http_version: undefined,
      elapsed_ms,
      content_type: res.headers.get('content-type') || null,
      content_length: res.headers.get('content-length') || null,
      security: sec,
    };
  } catch (err) {
    const elapsed_ms = Date.now() - started;
    const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
    return { ok: false, error: msg, elapsed_ms, url: parsed.href };
  }
}

async function redirectTrace(args) {
  let current;
  try {
    current = parseHttpUrl(args.url).href;
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const hops = [];
  for (let i = 0; i < 10; i++) {
    let parsed;
    try {
      parsed = parseHttpUrl(current);
      await assertPublicHost(parsed.hostname);
    } catch (err) {
      hops.push({ url: current, error: err.message });
      break;
    }

    try {
      const res = await fetchWithTimeout(
        parsed.href,
        { method: 'GET', redirect: 'manual', headers: { 'User-Agent': UA, Accept: '*/*' } },
        8000
      );
      try {
        await res.body?.cancel?.();
      } catch {
        /* ignore */
      }
      const loc = res.headers.get('location');
      hops.push({
        url: parsed.href,
        status: res.status,
        location: loc || null,
      });
      if (!loc || res.status < 300 || res.status >= 400) break;
      current = new URL(loc, parsed.href).href;
    } catch (err) {
      const msg = err?.name === 'AbortError' ? 'Timed out' : err.message;
      hops.push({ url: parsed.href, error: msg });
      break;
    }
  }

  return {
    ok: true,
    start: hops[0]?.url || current,
    final: hops[hops.length - 1]?.location || hops[hops.length - 1]?.url,
    hop_count: hops.length,
    hops,
  };
}

async function websiteUp(args) {
  let parsed;
  try {
    parsed = parseHttpUrl(args.url);
    await assertPublicHost(parsed.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }
  const started = Date.now();
  try {
    const res = await fetchWithTimeout(
      parsed.href,
      { method: 'GET', redirect: 'follow', headers: { 'User-Agent': UA, Accept: '*/*' } },
      HTTP_TIMEOUT_MS
    );
    try {
      await res.body?.cancel?.();
    } catch {
      /* ignore */
    }
    const elapsed_ms = Date.now() - started;
    const up = res.status >= 200 && res.status < 400;
    return {
      ok: true,
      up,
      url: parsed.href,
      final_url: res.url || parsed.href,
      status: res.status,
      statusText: res.statusText,
      elapsed_ms,
    };
  } catch (err) {
    const elapsed_ms = Date.now() - started;
    const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
    return { ok: true, up: false, url: parsed.href, error: msg, elapsed_ms };
  }
}

async function emailDns(args) {
  let domain = String(args.domain || args.host || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .replace(/^@/, '');
  if (domain.includes('@')) domain = domain.split('@').pop();
  if (!domain) return { ok: false, error: 'domain is required' };
  try {
    await assertPublicHost(domain);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const [mx, txt, ns, dmarc] = await Promise.all([
    resolveDnsType(domain, 'MX'),
    resolveDnsType(domain, 'TXT'),
    resolveDnsType(domain, 'NS'),
    resolveDnsType(`_dmarc.${domain}`, 'TXT'),
  ]);

  const txtList = Array.isArray(txt) ? txt : [];
  const spf = txtList.filter(t => /^v=spf1/i.test(t));
  const dmarcList = Array.isArray(dmarc) ? dmarc.filter(t => /v=DMARC1/i.test(t)) : [];

  return {
    ok: true,
    domain,
    mx: Array.isArray(mx) ? mx : mx,
    spf,
    dmarc: dmarcList,
    ns: Array.isArray(ns) ? ns : ns,
    notes: [
      mx && Array.isArray(mx) && mx.length === 0 ? 'No MX records' : null,
      spf.length === 0 ? 'No SPF TXT found' : null,
      dmarcList.length === 0 ? 'No DMARC record at _dmarc.' + domain : null,
    ].filter(Boolean),
  };
}

function cidrInfo(args) {
  const raw = String(args.cidr || '').trim();
  const m = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!m) return { ok: false, error: 'Provide IPv4 CIDR like 192.0.2.0/24' };
  const ip = m[1];
  const prefix = Number(m[2]);
  const ipInt = ipv4ToInt(ip);
  if (ipInt == null) return { ok: false, error: 'Invalid IPv4 address' };
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return { ok: false, error: 'Prefix must be 0-32' };
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (ipInt & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const size = 2 ** (32 - prefix);
  const first = prefix >= 31 ? network : (network + 1) >>> 0;
  const last = prefix >= 31 ? broadcast : (broadcast - 1) >>> 0;
  return {
    ok: true,
    cidr: `${intToIpv4(network)}/${prefix}`,
    input: raw,
    netmask: intToIpv4(mask),
    wildcard: intToIpv4((~mask) >>> 0),
    network: intToIpv4(network),
    broadcast: intToIpv4(broadcast),
    first_usable: intToIpv4(first),
    last_usable: intToIpv4(last),
    total_addresses: size,
    usable_hosts: prefix >= 31 ? size : Math.max(0, size - 2),
    note: 'Calculated locally. This does not scan the range.',
  };
}

async function executeNetworkTool(name, args) {
  switch (name) {
    case 'dns_lookup':
      return dnsLookup(args || {});
    case 'reverse_dns':
      return reverseDns(args || {});
    case 'whois_lookup':
      return whoisLookup(args || {});
    case 'ssl_inspect':
      return sslInspect(args || {});
    case 'ip_info':
      return ipInfo(args || {});
    case 'http_probe':
      return httpProbe(args || {});
    case 'redirect_trace':
      return redirectTrace(args || {});
    case 'website_up':
      return websiteUp(args || {});
    case 'email_dns':
      return emailDns(args || {});
    case 'cidr_info':
      return cidrInfo(args || {});
    default:
      return null;
  }
}

module.exports = {
  networkToolDefs,
  executeNetworkTool,
  assertPublicHost,
  isPrivateIp,
};
