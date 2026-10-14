# Bilibili Surge CDN Candidate Priority

A Surge module for two observed playback paths: it reorders the CDN URLs in
Bilibili **JSON** playurl responses, and redirects matching cleartext iPad media
requests to a chosen CDN host.

The media route follows the [Japan Bilibili accelerator](https://github.com/taresky/japan-bilibili-accelerator/blob/main/README.md)
idea of keeping Bilibili traffic `DIRECT` while moving media to a Hong Kong EQ
CDN. That module matches HTTPS requests by CDN hostname. On this iPad, Surge
observed HTTP requests to CDN IP addresses, so the request script matches
that actual form and updates both the destination URL and `Host` header.

## What it does

For each DASH `video` / `audio` stream or `durl` entry, the full URL list
(`baseUrl`/`base_url`/`url` + `backupUrl`/`backup_url`) is
de-duplicated and stably sorted: hosts in `PreferredHosts` first (in the order
given), everything else after in original order. The original base URL remains in
the backup list, so the player can still fall back to it.

- URL strings are re-emitted from their original JSON tokens: signed query
  strings and escapes are preserved byte for byte. No host swapping.
- The rest of the body is untouched (large integer ids are not round-tripped
  through `JSON.parse`).
- The separate `http-request` script handles only iPad `GET` requests to a
  public IPv4 address under `/upgcxcode/` ending in `.m4s`, with
  `platform=ipad`, `os=akam` or `os=cosovbv`, and `gen=playurlv3`. It keeps
  the signed path and query exactly, changes the destination and `Host`, and
  retains `Range` and other headers. Other requests pass through unchanged.

It **fails open** (response passed through unchanged) on: disabled/empty
argument, non-200 status, invalid JSON, duplicate keys, `code != 0`, no
preferred match, already in preferred order, no backup, aliases that disagree
(`baseUrl` vs `base_url`, `backupUrl` vs `backup_url`), non-http(s) URLs, or any
unknown structure. `$done` is called exactly once.

## Install

The module's `script-path` entries point to the public companion scripts
`accelerator.js` and `media-redirect.js` in this directory.

1. In Surge, install the module from this exact URL:
   `https://raw.githubusercontent.com/didogakki/rules/main/bilibili-surge-accelerator/Bilibili.Accelerator.sgmodule`
2. Enable the module and enable MITM.

The remote module downloads its companion scripts automatically.

For offline use, copy the module, `accelerator.js`, and `media-redirect.js` into
the Surge profile directory and replace both remote `script-path` URLs with the
matching local filenames.

The separate `Bilibili.iPad.Local.sgmodule` is for local testing: copy it and
`media-redirect.js` into the Surge profile directory. Disable this local module
when using the remote module above, which now contains the same media rule.

Arguments:

| Name | Default | Meaning |
| --- | --- | --- |
| `Enabled` | `true` | `false` turns the script into a no-op |
| `PreferredHosts` | `upos-sz-mirrorcos.bilivideo.com` | Hostnames in priority order, separated by `\|`, spaces, `,` or `;`. `example.com` = exact host; `.example.com` / `*.example.com` = that domain and subdomains. Ports ignored. The default is only an example; set hosts that work on your network. |
| `MediaEnabled` | `true` | `false` leaves iPad media requests unchanged. |
| `MediaHost` | `cn-hk-eq-01-04.bilivideo.com` | Destination CDN for matching iPad media requests. Only `bilivideo.com` hostnames are accepted. |

## Scope and limits

- **JSON playurl**: `api.bilibili.com` `x/player/playurl`,
  `x/player/wbi/playurl`, `pgc/player/web/playurl`, `pgc/player/api/playurl`.
- **iPad media**: the narrow cleartext request shape above. The native App may
  use other paths, transports, or HTTPS; those remain unchanged. Signed URLs
  must be accepted by the selected CDN. The script does not measure throughput
  or switch midstream if that CDN slows or fails.
- **Not covered**: first-play data embedded in HTML pages and adaptive
  buffering / player-side CDN switching.
- The JSON script only changes preference order. The media script changes the
  request destination; neither guarantees a faster or more stable CDN.

## Conflicts

Other `http-response` scripts matching the same URLs (other Bilibili modules,
ad blockers, quality unlockers, DASH rewriters) conflict: Surge runs only the
FIRST enabled matching script per response, so overlapping scripts do not
chain. Disable overlapping modules, or merge their logic into one script. This
script cannot detect such conflicts.

The same repository also contains `Bilibili-CDN-Rewrite.sgmodule`, which
rewrites media request hosts. It uses a different script type (request stage),
so it does not necessarily conflict with this module, but if both are enabled
the older request-stage rewrite can override the address this module selected.
Disable the older module when evaluating this one.

## MITM

The module appends `api.bilibili.com` to `[MITM] hostname`. Surge needs MITM
enabled with its CA installed and trusted. Apps with certificate pinning will
fail or bypass MITM. Remove the module to stop intercepting the host. `requires-body=1`
with `max-size=1048576` bounds the body; larger responses are skipped by Surge.
The observed iPad media requests use plain HTTP and do not require MITM for
the media redirect itself.

## Validation

```sh
node --check accelerator.js
node --check media-redirect.js
node --test accelerator.test.cjs media-redirect.test.cjs
```

To verify in Surge: play a new video on the iPad and check that new `.m4s`
requests reach `MediaHost` with 206/200 responses and no playback failure.
Compare several minutes of playback with media redirection enabled and disabled,
including a clip that normally stalls after a few seconds. Check completed
`.m4s` requests, failed requests, repeated ranges, and whether playback stays
continuous. A short 128 KB Range request measures startup overhead, not stall
frequency: on 2026-10-15 the original CDN was sometimes faster on these small
requests, while the HK EQ route completed 42 observed media requests and
delivered about 21.6 MB during a 30-second trial. For the JSON path, compare
`baseUrl` and `backupUrl` in a captured playurl response.
