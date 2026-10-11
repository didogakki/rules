/*
 * Bilibili playurl CDN candidate priority (Surge http-response, JSON only).
 *
 * Reorders the server-issued URLs of each DASH audio/video or durl stream so
 * hosts named in `preferred` come first. Every unique URL stays in the stream
 * (the original base URL becomes a backup); URL bytes are never modified and
 * only the affected string tokens of the body are re-emitted, so the rest of
 * the body (e.g. 64-bit ids) is preserved byte for byte.
 * Anything unexpected -> fail open (no body returned, response untouched).
 */
(function (root) {
  'use strict';

  var MAX_DEPTH = 64;

  // ---- minimal span-tracking JSON parser (strict, rejects duplicate keys) ----
  function parseJson(text) {
    var i = 0;
    function fail() { throw new Error('json'); }
    function ws() {
      while (i < text.length) {
        var c = text.charCodeAt(i);
        if (c === 32 || c === 9 || c === 10 || c === 13) i++; else break;
      }
    }
    function str() {
      var s = i;
      if (text[i] !== '"') fail();
      i++;
      var closed = false;
      while (i < text.length) {
        var c = text.charCodeAt(i);
        if (c === 34) { i++; closed = true; break; }
        if (c < 32) fail();
        if (c === 92) i++;
        i++;
      }
      if (!closed) fail();
      var raw = text.slice(s, i);
      var v;
      try { v = JSON.parse(raw); } catch (e) { fail(); }
      return { t: 's', s: s, e: i, v: v, raw: raw };
    }
    function val(depth) {
      if (depth > MAX_DEPTH) fail();
      ws();
      var s = i, c = text[i];
      if (c === '{') {
        i++;
        var props = Object.create(null), n = { t: 'o', s: s, props: props };
        ws();
        if (text[i] === '}') { i++; n.e = i; return n; }
        for (;;) {
          ws();
          var k = str();
          if (k.v in props) fail();
          ws();
          if (text[i++] !== ':') fail();
          props[k.v] = val(depth + 1);
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === '}') { i++; break; }
          fail();
        }
        n.e = i;
        return n;
      }
      if (c === '[') {
        i++;
        var items = [], a = { t: 'a', s: s, items: items };
        ws();
        if (text[i] === ']') { i++; a.e = i; return a; }
        for (;;) {
          items.push(val(depth + 1));
          ws();
          if (text[i] === ',') { i++; continue; }
          if (text[i] === ']') { i++; break; }
          fail();
        }
        a.e = i;
        return a;
      }
      if (c === '"') return str();
      var m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
      if (!m) fail();
      i += m[0].length;
      return { t: 'p', s: s, e: i, raw: m[0] };
    }
    var rootNode = val(0);
    ws();
    if (i !== text.length) fail();
    return rootNode;
  }

  // ---- arguments ----
  function parseArgument(arg) {
    var out = { enabled: true, preferred: '' };
    if (arg && typeof arg === 'object') {
      arg = Object.keys(arg).map(function (k) { return k + '=' + arg[k]; }).join('&');
    }
    if (typeof arg !== 'string') return out;
    arg.split('&').forEach(function (kv) {
      var p = kv.indexOf('=');
      if (p < 0) return;
      var k = kv.slice(0, p).trim().toLowerCase(), v = kv.slice(p + 1).trim();
      if (k === 'enabled') out.enabled = !/^(?:false|0|off|no|disabled?)$/i.test(v);
      else if (k === 'preferred' || k === 'preferredhost' || k === 'preferredhosts') out.preferred = v;
    });
    return out;
  }

  function parsePreferred(s) {
    return String(s || '').split(/[\s,;|]+/).map(function (h) { return h.trim().toLowerCase(); })
      .filter(function (h) { return h && !/^\{\{\{.*\}\}\}$/.test(h) && !/^(?:null|undefined)$/.test(h); });
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^\/?#]*)/i.exec(url);
    if (!m || m[1].indexOf('@') >= 0) return null;
    var h = m[1].toLowerCase().replace(/:\d*$/, '');
    return h || null;
  }

  // entry "example.com" = exact host; ".example.com" / "*.example.com" = subdomains (and apex)
  function rankOf(url, prefs) {
    var h = hostOf(url);
    if (!h) return -1;
    for (var i = 0; i < prefs.length; i++) {
      var p = prefs[i];
      if (p.charAt(0) === '*') p = p.slice(1);
      if (p.charAt(0) === '.') {
        if (h === p.slice(1) || (h.length > p.length && h.slice(-p.length) === p)) return i;
      } else if (h === p) return i;
    }
    return prefs.length;
  }

  // ---- stream handling ----
  function isObj(n) { return n && n.t === 'o'; }

  function planStream(node, kind, prefs, edits) {
    if (!isObj(node)) return;
    var P = kind === 'durl' ? ['url'] : ['baseUrl', 'base_url'];
    var B = kind === 'durl' ? ['backup_url', 'backupUrl'] : ['backupUrl', 'backup_url'];
    var pn = P.filter(function (k) { return k in node.props; }).map(function (k) { return node.props[k]; });
    var bn = B.filter(function (k) { return k in node.props; }).map(function (k) { return node.props[k]; });
    if (!pn.length || !bn.length) return;
    if (pn.some(function (n) { return n.t !== 's' || n.v !== pn[0].v; })) return;
    var firstBackup = null;
    for (var a = 0; a < bn.length; a++) {
      if (bn[a].t !== 'a' || !bn[a].items.every(function (n) { return n.t === 's'; })) return;
      var sig = JSON.stringify(bn[a].items.map(function (n) { return n.v; }));
      if (firstBackup === null) firstBackup = sig;
      else if (sig !== firstBackup) return; // aliases disagree: conflict
    }
    var all = [{ v: pn[0].v, raw: pn[0].raw }].concat(bn[0].items.map(function (n) { return { v: n.v, raw: n.raw }; }));
    var cands = [], seen = Object.create(null);
    for (var j = 0; j < all.length; j++) {
      if (hostOf(all[j].v) === null) return; // not a full http(s) URL: unknown structure
      if (seen[all[j].v]) continue;
      seen[all[j].v] = 1;
      cands.push(all[j]);
    }
    if (cands.length < 2) return;
    var ranked = cands.map(function (c, idx) {
      var r = rankOf(c.v, prefs);
      return { c: c, idx: idx, r: r === prefs.length ? Infinity : r };
    });
    if (!ranked.some(function (x) { return x.r !== Infinity; })) return;
    ranked.sort(function (x, y) { return x.r === y.r ? x.idx - y.idx : (x.r < y.r ? -1 : 1); });
    var order = ranked.map(function (x) { return x.c; });
    var newBackup = JSON.stringify(order.slice(1).map(function (c) { return c.v; }));
    if (order[0].v === pn[0].v && newBackup === firstBackup) return;
    pn.forEach(function (n) { edits.push({ s: n.s, e: n.e, t: order[0].raw }); });
    var arr = '[' + order.slice(1).map(function (c) { return c.raw; }).join(',') + ']';
    bn.forEach(function (n) { edits.push({ s: n.s, e: n.e, t: arr }); });
  }

  // Returns the rewritten body, or null for "leave the response alone".
  function rewrite(body, argument) {
    var opt = parseArgument(argument);
    if (!opt.enabled) return null;
    var prefs = parsePreferred(opt.preferred);
    if (!prefs.length) return null;
    if (typeof body !== 'string') return null;
    var doc;
    try { doc = parseJson(body); } catch (e) { return null; }
    if (!isObj(doc)) return null;
    var code = doc.props.code;
    if (!code || code.t !== 'p' || code.raw !== '0') return null;

    var roots = [], seenRoot = Object.create(null);
    function addRoot(n) { if (isObj(n) && !seenRoot[n.s]) { seenRoot[n.s] = 1; roots.push(n); } }
    ['data', 'result'].forEach(function (k) {
      var r = doc.props[k];
      addRoot(r);
      if (isObj(r)) addRoot(r.props.video_info);
    });
    var edits = [];
    roots.forEach(function (r) {
      var dash = r.props.dash;
      if (isObj(dash)) {
        ['video', 'audio'].forEach(function (k) {
          var list = dash.props[k];
          if (list && list.t === 'a') list.items.forEach(function (s) { planStream(s, 'dash', prefs, edits); });
        });
      }
      var durl = r.props.durl;
      if (durl && durl.t === 'a') durl.items.forEach(function (s) { planStream(s, 'durl', prefs, edits); });
    });
    if (!edits.length) return null;
    edits.sort(function (x, y) { return y.s - x.s; });
    for (var i = 1; i < edits.length; i++) if (edits[i].e > edits[i - 1].s) return null;
    var out = body;
    edits.forEach(function (ed) { out = out.slice(0, ed.s) + ed.t + out.slice(ed.e); });
    try { JSON.parse(out); } catch (e) { return null; }
    return out;
  }

  var api = { rewrite: rewrite, parseArgument: parseArgument, parsePreferred: parsePreferred };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;

  if (typeof $done === 'function' && typeof $response !== 'undefined') {
    var result = {};
    try {
      var status = $response.status;
      if (status === undefined || status === 200 || status === '200') {
        var out = rewrite($response.body, typeof $argument === 'undefined' ? '' : $argument);
        if (typeof out === 'string') result = { body: out };
      }
    } catch (e) { result = {}; }
    $done(result);
  }
})(this);
