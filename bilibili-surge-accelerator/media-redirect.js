'use strict';

// Rewrite the iPad app's cleartext media request before Surge chooses a route.
(function () {
  function publicIPv4(host) {
    var parts = host.split('.');
    if (parts.length !== 4) return false;
    var n = parts.map(function (part) {
      return /^(?:0|[1-9]\d{0,2})$/.test(part) ? Number(part) : -1;
    });
    if (n.some(function (part) { return part < 0 || part > 255; })) return false;
    if (n[0] === 0 || n[0] === 10 || n[0] === 127 || n[0] >= 224) return false;
    if (n[0] === 169 && n[1] === 254) return false;
    if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return false;
    if (n[0] === 192 && n[1] === 168) return false;
    return true;
  }

  function preferredHost(argument) {
    if (typeof argument !== 'string') return null;
    var params = Object.create(null);
    argument.split('&').forEach(function (part) {
      var i = part.indexOf('=');
      if (i !== -1) params[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
    });
    if (params.enabled !== 'true') return null;
    var host = params.host;
    if (!host || host.length > 253 || !/^(?:[a-z0-9-]+\.)+bilivideo\.com$/i.test(host)) return null;
    return host.toLowerCase();
  }

  function rewrite(request, argument) {
    var target = preferredHost(argument);
    if (!target || !request || request.method !== 'GET' || typeof request.url !== 'string') return null;
    var match = /^http:\/\/([^\/:?#]+)(?::\d+)?(\/upgcxcode\/[^?#]+\.m4s)(\?[^#]+)$/.exec(request.url);
    if (!match || !publicIPv4(match[1])) return null;
    var query = match[3].slice(1);
    if (!/(?:^|&)platform=ipad(?:&|$)/.test(query) ||
        !/(?:^|&)os=(?:akam|cosovbv)(?:&|$)/.test(query) ||
        !/(?:^|&)gen=playurlv3(?:&|$)/.test(query)) return null;
    var headers = request.headers;
    if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return null;
    var changed = {};
    Object.keys(headers).forEach(function (key) {
      if (key.toLowerCase() !== 'host') changed[key] = headers[key];
    });
    changed.Host = target;
    return { url: 'http://' + target + match[2] + match[3], headers: changed };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = { rewrite: rewrite };
  if (typeof $done === 'function' && typeof $request !== 'undefined') {
    var result = {};
    try { result = rewrite($request, typeof $argument === 'undefined' ? '' : $argument) || {}; }
    catch (e) { result = {}; }
    $done(result);
  }
})();
