/*
 * Surge script for Bilibili CDN host replacement.
 * Argument: target CDN host, e.g. cn-hk-eq-01-01.bilivideo.com
 */

const TARGET_HOST = String(typeof $argument === "string" && $argument ? $argument : "cn-hk-eq-01-01.bilivideo.com")
  .replace(/^https?:\/\//i, "")
  .replace(/\/.*$/, "")
  .trim();

const MEDIA_HOST_RE = /(?:bilivideo|acgvideo)\.(?:com|cn)$|edge\.mountaintoys\.cn$|akamaized\.net$/i;
const MEDIA_URL_RE = /https?:\/\/([^/?#"'\\\s]+)(\/[^"'\\\s]*)?/gi;
const IGNORE_HOST_RE = /^(?:bvc|data|pbp|api|api\w+)\./i;

function isMediaHost(host) {
  return typeof host === "string" && MEDIA_HOST_RE.test(host);
}

function shouldIgnoreHost(host) {
  return typeof host === "string" && IGNORE_HOST_RE.test(host);
}

function replaceUrl(raw) {
  if (!raw || !TARGET_HOST) return raw;
  try {
    const u = new URL(raw);
    if (!isMediaHost(u.hostname) || shouldIgnoreHost(u.hostname)) return raw;
    u.protocol = "https:";
    u.host = TARGET_HOST;
    return u.toString();
  } catch (_) {
    return raw;
  }
}

function replaceMediaUrlsInText(text) {
  if (typeof text !== "string" || !TARGET_HOST) return text;
  return text.replace(MEDIA_URL_RE, (matched, host) => {
    if (!isMediaHost(host) || shouldIgnoreHost(host)) return matched;
    return replaceUrl(matched);
  });
}

function replaceHostValue(raw) {
  if (typeof raw !== "string" || !TARGET_HOST) return raw;
  const value = raw.replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!isMediaHost(value) || shouldIgnoreHost(value)) return raw;
  if (/^https?:\/\//i.test(raw)) return "https://" + TARGET_HOST;
  return TARGET_HOST;
}

function deepReplace(obj) {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const v = obj[i];
      if (typeof v === "string") obj[i] = replaceMediaUrlsInText(v);
      else if (v && typeof v === "object") deepReplace(v);
    }
    return obj;
  }

  for (const key of Object.keys(obj)) {
    const v = obj[key];
    if (typeof v === "string") {
      obj[key] = key === "host" ? replaceHostValue(v) : replaceMediaUrlsInText(v);
    } else if (v && typeof v === "object") {
      deepReplace(v);
    }
  }
  return obj;
}

function handleRequest() {
  const nextUrl = replaceUrl($request.url);
  if (nextUrl === $request.url) {
    $done({});
    return;
  }

  const headers = Object.assign({}, $request.headers || {});
  headers.Host = TARGET_HOST;
  headers.host = TARGET_HOST;

  $done({ url: nextUrl, headers });
}

function handleResponse() {
  const body = $response && $response.body;
  if (typeof body !== "string" || !body) {
    $done({});
    return;
  }

  let nextBody = body;
  const trimmed = body.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const obj = JSON.parse(body);
      deepReplace(obj);
      nextBody = JSON.stringify(obj);
    } catch (_) {
      nextBody = replaceMediaUrlsInText(body);
    }
  } else {
    nextBody = replaceMediaUrlsInText(body);
  }

  if (nextBody === body) {
    $done({});
    return;
  }

  const headers = Object.assign({}, $response.headers || {});
  delete headers["Content-Length"];
  delete headers["content-length"];
  $done({ body: nextBody, headers });
}

if (typeof $response !== "undefined") {
  handleResponse();
} else {
  handleRequest();
}
