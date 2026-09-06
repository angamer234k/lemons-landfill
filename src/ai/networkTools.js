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
  {
    type: 'function',
    function: {
      name: 'security_audit',
      description:
        'One-shot security review of a public URL/host: TLS, HTTP security headers, cookies, CORS, HTTPS, redirects, security.txt, DNS/mail auth. Returns a findings list with severity. Use when the user wants vulns/misconfig, not a full exploit.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'URL or hostname to audit, e.g. https://example.com' } },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'http_request',
      description:
        'Send one HTTP request with a specific method, headers, query, and body to a public URL. Use to debug an API or try particular input the user (or you) want to test. POST/PUT/PATCH/DELETE only on endpoints the user asked to test. Returns status, headers, timing, and a truncated body.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL' },
          method: {
            type: 'string',
            enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
            description: 'HTTP method. Default GET.',
          },
          headers: {
            type: 'object',
            description: 'Optional request headers as key-value strings',
          },
          query: {
            type: 'object',
            description: 'Optional query string params (merged into the URL)',
          },
          body: {
            type: 'string',
            description: 'Optional request body (JSON or form string). Ignored for GET/HEAD.',
          },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'api_probe',
      description:
        'Hit an API endpoint with a small set of unexpected-but-benign variants (OPTIONS, extra fields, malformed JSON, type confusion, missing auth, wrong Content-Type) and flag responses that differ or leak errors/stack traces. Not an exploit pack. Max a handful of requests. Never sends DELETE.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'API endpoint URL' },
          method: {
            type: 'string',
            enum: ['GET', 'POST', 'PUT', 'PATCH'],
            description: 'Baseline method. Default POST if body is set, else GET.',
          },
          headers: {
            type: 'object',
            description: 'Optional headers (Authorization, Content-Type, etc.)',
          },
          body: {
            type: 'string',
            description: 'Optional baseline JSON body as a string',
          },
        },
        required: ['url'],
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

const REQ_BODY_MAX = 32_000;
const RESP_BODY_MAX = 80_000;
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

function applyQuery(url, query) {
  if (!query || typeof query !== 'object') return url;
  const u = new URL(url);
  for (const [k, v] of Object.entries(query)) {
    if (v == null) continue;
    u.searchParams.set(String(k), String(v));
  }
  return u.href;
}

function mergeHeaders(extra) {
  const headers = { 'User-Agent': UA, Accept: '*/*' };
  if (extra && typeof extra === 'object') {
    for (const [k, v] of Object.entries(extra)) {
      if (v == null) continue;
      const key = String(k);
      if (/^host$/i.test(key)) continue;
      headers[key] = String(v);
    }
  }
  return headers;
}

function previewBody(text, max = 1200) {
  const s = String(text || '');
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function leakHints(status, text) {
  const hints = [];
  const t = String(text || '');
  if (status >= 500) hints.push('server_error');
  const checks = [
    [/sqlstate|sqlite|postgresql|mysql error|ora-\d+|syntax error at or near/i, 'db_error'],
    [/traceback \(most recent call last\)|stack trace|at Object\.|unhandled exception/i, 'stack_trace'],
    [/\/var\/www|\/home\/\w+|C:\\Users\\|site-packages/i, 'path_disclosure'],
    [/xdebug|whoops!|debugbar|django traceback|werkzeug debugger/i, 'debug_page'],
    [/undefined index|cannot read propert|nullpointer|typeerror:/i, 'verbose_runtime'],
  ];
  for (const [re, tag] of checks) {
    if (re.test(t)) hints.push(tag);
  }
  return hints;
}

async function publicHttpRequest({ url, method = 'GET', headers, body, query, maxHops = 5 }) {
  let current;
  try {
    current = applyQuery(parseHttpUrl(url).href, query);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  method = String(method || 'GET').toUpperCase();
  if (!HTTP_METHODS.includes(method)) {
    return { ok: false, error: `method must be one of ${HTTP_METHODS.join(', ')}` };
  }

  let sendBody = null;
  if (body != null && method !== 'GET' && method !== 'HEAD') {
    sendBody = String(body);
    if (sendBody.length > REQ_BODY_MAX) {
      return { ok: false, error: `body too large (max ${REQ_BODY_MAX} bytes)` };
    }
  }

  const hdrs = mergeHeaders(headers);
  if (sendBody != null && !Object.keys(hdrs).some(k => k.toLowerCase() === 'content-type')) {
    const trimmed = sendBody.trim();
    hdrs['Content-Type'] =
      trimmed.startsWith('{') || trimmed.startsWith('[') ? 'application/json' : 'text/plain';
  }

  const hops = [];
  const started = Date.now();
  let lastRes = null;
  let finalUrl = current;

  for (let i = 0; i < maxHops; i++) {
    let parsed;
    try {
      parsed = parseHttpUrl(current);
      await assertPublicHost(parsed.hostname);
    } catch (err) {
      return { ok: false, error: err.message, url: current, elapsed_ms: Date.now() - started, hops };
    }

    try {
      const init = { method, headers: hdrs, redirect: 'manual' };
      if (sendBody != null && i === 0) init.body = sendBody;
      // After a redirect, GET the next hop without replaying a mutating body.
      if (i > 0) {
        init.method = method === 'HEAD' ? 'HEAD' : 'GET';
        delete init.body;
      }
      const res = await fetchWithTimeout(parsed.href, init, HTTP_TIMEOUT_MS);
      lastRes = res;
      finalUrl = res.url || parsed.href;
      const loc = res.headers.get('location');
      hops.push({ url: parsed.href, status: res.status, location: loc || null });

      if (loc && res.status >= 300 && res.status < 400) {
        try {
          await res.body?.cancel?.();
        } catch {
          /* ignore */
        }
        current = new URL(loc, parsed.href).href;
        continue;
      }
      break;
    } catch (err) {
      const msg = err?.name === 'AbortError' ? `Timed out after ${HTTP_TIMEOUT_MS}ms` : err.message;
      return { ok: false, error: msg, url: parsed.href, elapsed_ms: Date.now() - started, hops };
    }
  }

  if (!lastRes) return { ok: false, error: 'No response', url: current, elapsed_ms: Date.now() - started };

  const interesting = [
    'content-type',
    'content-length',
    'server',
    'x-powered-by',
    'location',
    'www-authenticate',
    'allow',
    'access-control-allow-origin',
    'access-control-allow-credentials',
    'access-control-allow-methods',
    'set-cookie',
    'cache-control',
    'x-request-id',
  ];
  const outHeaders = {};
  for (const key of interesting) {
    const v = lastRes.headers.get(key);
    if (v) outHeaders[key] = v.length > 400 ? v.slice(0, 400) + '…' : v;
  }

  let bodyText = '';
  let truncated = false;
  let bytes = 0;
  if (method !== 'HEAD') {
    const cap = await readCappedText(lastRes, RESP_BODY_MAX);
    bodyText = cap.text;
    truncated = cap.truncated;
    bytes = cap.bytes;
  } else {
    try {
      await lastRes.body?.cancel?.();
    } catch {
      /* ignore */
    }
  }

  const elapsed_ms = Date.now() - started;
  const hints = leakHints(lastRes.status, bodyText);
  const cookies = parseCookieFlags(outHeaders['set-cookie'], lastRes.headers);
  return {
    ok: true,
    url: finalUrl,
    requested: hops[0]?.url || current,
    method,
    status: lastRes.status,
    statusText: lastRes.statusText,
    redirected: hops.length > 1,
    hops,
    headers: outHeaders,
    cookies: cookies.length ? cookies : undefined,
    elapsed_ms,
    body_bytes: bytes,
    body_truncated: truncated,
    body: previewBody(bodyText, 4000),
    leak_hints: hints.length ? hints : undefined,
  };
}

async function readCappedText(res, maxBytes) {
  if (!res.body) {
    const text = await res.text();
    const buf = Buffer.from(text, 'utf8');
    if (buf.length <= maxBytes) return { text, bytes: buf.length, truncated: false };
    return { text: buf.subarray(0, maxBytes).toString('utf8'), bytes: maxBytes, truncated: true };
  }
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    const remaining = maxBytes - total;
    if (remaining <= 0) {
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    if (value.byteLength > remaining) {
      chunks.push(value.slice(0, remaining));
      total += remaining;
      truncated = true;
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      break;
    }
    chunks.push(value);
    total += value.byteLength;
  }
  const buf = Buffer.concat(chunks.map(c => Buffer.from(c)));
  return { text: buf.toString('utf8'), bytes: total, truncated };
}

function parseCookieFlags(setCookieHeader, headers) {
  const raw = [];
  if (headers && typeof headers.getSetCookie === 'function') {
    try {
      raw.push(...headers.getSetCookie());
    } catch {
      /* ignore */
    }
  }
  if (!raw.length && setCookieHeader) raw.push(setCookieHeader);
  return raw.slice(0, 12).map(c => {
    const parts = String(c).split(';').map(s => s.trim());
    const name = (parts[0] || '').split('=')[0];
    const flags = parts.slice(1).map(p => p.toLowerCase());
    const samesite = (flags.find(f => f.startsWith('samesite=')) || '').split('=')[1] || null;
    return {
      name,
      secure: flags.some(f => f === 'secure'),
      httponly: flags.some(f => f === 'httponly'),
      samesite,
    };
  });
}

async function httpRequest(args) {
  return publicHttpRequest({
    url: args.url,
    method: args.method,
    headers: args.headers,
    body: args.body,
    query: args.query,
  });
}

function tryParseJson(s) {
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch {
    return { ok: false };
  }
}

async function apiProbe(args) {
  let parsed;
  try {
    parsed = parseHttpUrl(args.url);
    await assertPublicHost(parsed.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const hasBody = args.body != null && String(args.body).trim() !== '';
  let method = String(args.method || (hasBody ? 'POST' : 'GET')).toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH'].includes(method)) {
    return { ok: false, error: 'api_probe only allows GET, POST, PUT, or PATCH (no DELETE)' };
  }

  const baseHeaders = args.headers && typeof args.headers === 'object' ? { ...args.headers } : {};
  const baseBody = hasBody ? String(args.body) : null;
  const probes = [];

  const run = async (label, opts) => {
    const res = await publicHttpRequest({
      url: parsed.href,
      method: opts.method || method,
      headers: opts.headers != null ? opts.headers : baseHeaders,
      body: opts.body !== undefined ? opts.body : baseBody,
      query: opts.query,
    });
    const interesting =
      !res.ok ||
      (opts.baselineStatus != null && res.status !== opts.baselineStatus) ||
      (res.leak_hints && res.leak_hints.length > 0);
    probes.push({
      label,
      ok: res.ok,
      status: res.status,
      error: res.ok ? undefined : res.error,
      elapsed_ms: res.elapsed_ms,
      content_type: res.headers && res.headers['content-type'],
      leak_hints: res.leak_hints,
      body_preview: res.body ? previewBody(res.body, 600) : undefined,
      interesting: !!interesting,
    });
    return res;
  };

  const baseline = await run('baseline', { method, baselineStatus: null });
  const baseStatus = baseline.ok ? baseline.status : null;

  await run('OPTIONS', { method: 'OPTIONS', body: null, headers: baseHeaders, baselineStatus: baseStatus });

  const json = baseBody ? tryParseJson(baseBody) : { ok: false };
  if (json.ok && json.value && typeof json.value === 'object' && !Array.isArray(json.value)) {
    const extra = { ...json.value, __unexpected: true, __probe: 1 };
    await run('extra_json_fields', {
      method,
      body: JSON.stringify(extra),
      headers: baseHeaders,
      baselineStatus: baseStatus,
    });

    const keys = Object.keys(json.value);
    const strKey = keys.find(k => typeof json.value[k] === 'string') || keys[0];
    if (strKey) {
      const confused = { ...json.value, [strKey]: [json.value[strKey], { n: 1 }] };
      await run(`type_confusion:${strKey}`, {
        method,
        body: JSON.stringify(confused),
        headers: baseHeaders,
        baselineStatus: baseStatus,
      });
    }
  } else if (method === 'GET') {
    await run('extra_query_param', {
      method: 'GET',
      body: null,
      headers: baseHeaders,
      query: { __probe: '1' },
      baselineStatus: baseStatus,
    });
  }

  if (method !== 'GET' && method !== 'HEAD') {
    await run('malformed_json', {
      method,
      body: '{"broken":',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      baselineStatus: baseStatus,
    });
    await run('wrong_content_type', {
      method,
      body: baseBody || '{}',
      headers: { ...baseHeaders, 'Content-Type': 'text/plain' },
      baselineStatus: baseStatus,
    });
  }

  const authKey = Object.keys(baseHeaders).find(k =>
    /^(authorization|x-api-key|api-key|cookie)$/i.test(k)
  );
  if (authKey) {
    const dropped = { ...baseHeaders };
    delete dropped[authKey];
    await run(`missing_${authKey}`, {
      method,
      body: baseBody,
      headers: dropped,
      baselineStatus: baseStatus,
    });
  }

  const interesting = probes.filter(p => p.interesting);
  return {
    ok: true,
    url: parsed.href,
    method,
    probe_count: probes.length,
    baseline_status: baseStatus,
    probes,
    interesting,
    note:
      'Benign unexpected-input checks only. Differing status, 5xx, or leak_hints (stack traces, SQL errors, path disclosure) are the useful bits. Not an exploit scan.',
  };
}

function addFinding(findings, severity, title, detail) {
  findings.push({ severity, title, detail });
}

async function securityAudit(args) {
  let parsed;
  try {
    parsed = parseHttpUrl(args.url || args.host);
    await assertPublicHost(parsed.hostname);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const href = parsed.href;
  const host = parsed.hostname;
  const findings = [];

  const [ssl, probe, mail, page, cors, secTxt] = await Promise.all([
    parsed.protocol === 'https:' ? sslInspect({ host }) : Promise.resolve({ ok: false, skipped: true }),
    httpProbe({ url: href }),
    emailDns({ domain: host }).catch(() => ({ ok: false })),
    publicHttpRequest({ url: href, method: 'GET' }),
    publicHttpRequest({
      url: href,
      method: 'GET',
      headers: { Origin: 'https://evil.example' },
    }),
    publicHttpRequest({
      url: `${parsed.protocol}//${host}/.well-known/security.txt`,
      method: 'GET',
    }),
  ]);

  if (parsed.protocol === 'http:') {
    addFinding(findings, 'high', 'Served over HTTP', 'No TLS on the requested URL. Credentials and cookies can be sniffed.');
  }

  if (ssl && ssl.ok) {
    if (ssl.authorized === false) {
      addFinding(
        findings,
        'high',
        'TLS certificate not trusted',
        ssl.authorizationError || 'Handshake succeeded but the cert did not validate.'
      );
    }
    if (typeof ssl.days_until_expiry === 'number') {
      if (ssl.days_until_expiry < 0) addFinding(findings, 'high', 'TLS certificate expired', ssl.valid_to);
      else if (ssl.days_until_expiry <= 14) {
        addFinding(findings, 'high', 'TLS certificate expires soon', `${ssl.days_until_expiry} days (${ssl.valid_to})`);
      } else if (ssl.days_until_expiry <= 30) {
        addFinding(findings, 'medium', 'TLS certificate expires within 30 days', `${ssl.days_until_expiry} days`);
      }
    }
    if (ssl.protocol && /TLSv1(\.0|\.1)?$/i.test(ssl.protocol)) {
      addFinding(findings, 'high', 'Old TLS protocol', ssl.protocol);
    }
  } else if (parsed.protocol === 'https:' && ssl && !ssl.skipped && !ssl.ok) {
    addFinding(findings, 'high', 'TLS handshake failed', ssl.error || 'unknown');
  }

  if (probe && probe.ok && probe.security) {
    for (const note of probe.security.notes || []) {
      const sev = /strict-transport|content-security-policy/i.test(note) ? 'medium' : 'low';
      addFinding(findings, sev, 'Missing security header', note);
    }
    const powered = probe.security.headers && probe.security.headers['x-powered-by'];
    if (powered) addFinding(findings, 'low', 'X-Powered-By exposes stack', powered);
    const server = probe.security.headers && probe.security.headers.server;
    if (server) addFinding(findings, 'info', 'Server header', server);
  } else if (probe && !probe.ok) {
    addFinding(findings, 'medium', 'HTTP probe failed', probe.error || 'unknown');
  }

  if (page && page.ok) {
    const cookies = page.cookies || parseCookieFlags(page.headers && page.headers['set-cookie'], null);
    for (const c of cookies) {
      if (parsed.protocol === 'https:' && !c.secure) {
        addFinding(findings, 'medium', `Cookie "${c.name}" missing Secure`, 'Can leak on HTTP requests.');
      }
      if (!c.httponly) addFinding(findings, 'low', `Cookie "${c.name}" missing HttpOnly`, 'Readable by JavaScript.');
      if (!c.samesite) addFinding(findings, 'low', `Cookie "${c.name}" missing SameSite`, 'More CSRF-prone.');
    }
    if (page.leak_hints && page.leak_hints.length) {
      addFinding(findings, 'high', 'Verbose error or leak in response body', page.leak_hints.join(', '));
    }
  }

  if (cors && cors.ok) {
    const acao = cors.headers && cors.headers['access-control-allow-origin'];
    const acac = cors.headers && cors.headers['access-control-allow-credentials'];
    if (acao === '*') {
      addFinding(findings, acac === 'true' ? 'high' : 'low', 'CORS Allow-Origin is *', 'Any site can read this response if the browser allows it.');
    } else if (acao && /evil\.example/i.test(acao)) {
      addFinding(findings, 'high', 'CORS reflects arbitrary Origin', acao);
    }
  }

  if (secTxt && secTxt.ok && secTxt.status === 200 && secTxt.body && /contact:/i.test(secTxt.body)) {
    addFinding(findings, 'info', 'security.txt present', previewBody(secTxt.body, 300));
  } else {
    addFinding(findings, 'info', 'No security.txt', '/.well-known/security.txt missing or empty');
  }

  if (mail && mail.ok) {
    for (const n of mail.notes || []) {
      addFinding(findings, /dmarc|spf/i.test(n) ? 'medium' : 'low', 'Mail DNS', n);
    }
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  findings.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));

  return {
    ok: true,
    url: href,
    host,
    summary: {
      high: findings.filter(f => f.severity === 'high').length,
      medium: findings.filter(f => f.severity === 'medium').length,
      low: findings.filter(f => f.severity === 'low').length,
      info: findings.filter(f => f.severity === 'info').length,
    },
    findings,
    tls: ssl && ssl.ok
      ? {
          authorized: ssl.authorized,
          protocol: ssl.protocol,
          valid_to: ssl.valid_to,
          days_until_expiry: ssl.days_until_expiry,
          issuer: ssl.issuer,
        }
      : ssl,
    http: probe && probe.ok ? { status: probe.status, final_url: probe.final_url, elapsed_ms: probe.elapsed_ms } : probe,
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
    case 'security_audit':
      return securityAudit(args || {});
    case 'http_request':
      return httpRequest(args || {});
    case 'api_probe':
      return apiProbe(args || {});
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
