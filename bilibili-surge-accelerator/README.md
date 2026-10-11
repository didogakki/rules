# Bilibili Surge CDN Candidate Priority

A Surge `http-response` module that reorders the CDN URLs the server already
issued in Bilibili **JSON** playurl responses, so your preferred hosts are tried
first. It never invents URLs.

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
- It does not handle media (`*.m4s`, `*.mp4`) requests.

It **fails open** (response passed through unchanged) on: disabled/empty
argument, non-200 status, invalid JSON, duplicate keys, `code != 0`, no
preferred match, already in preferred order, no backup, aliases that disagree
(`baseUrl` vs `base_url`, `backupUrl` vs `backup_url`), non-http(s) URLs, or any
unknown structure. `$done` is called exactly once.

## Install

The module's `script-path` points to the public companion script:
`https://raw.githubusercontent.com/didogakki/rules/main/bilibili-surge-accelerator/accelerator.js`

1. In Surge, install the module from this exact URL:
   `https://raw.githubusercontent.com/didogakki/rules/main/bilibili-surge-accelerator/Bilibili.Accelerator.sgmodule`
2. Enable the module and enable MITM.

Remote subscription uses its companion script automatically; you do not need to
download `accelerator.js` separately.

Local offline installation is still possible: copy the module and
`accelerator.js` into the Surge profile directory, edit the module's
`script-path` to the local path (`accelerator.js`), and enable the local module.

Arguments:

| Name | Default | Meaning |
| --- | --- | --- |
| `Enabled` | `true` | `false` turns the script into a no-op |
| `PreferredHosts` | `upos-sz-mirrorcos.bilivideo.com` | Hostnames in priority order, separated by `\|`, spaces, `,` or `;`. `example.com` = exact host; `.example.com` / `*.example.com` = that domain and subdomains. Ports ignored. The default is only an example; set hosts that work on your network. |

## Scope and limits

- **JSON playurl only**: `api.bilibili.com` `x/player/playurl`,
  `x/player/wbi/playurl`, `pgc/player/web/playurl`, `pgc/player/api/playurl`.
- **Not covered**: first-play data embedded in HTML pages, the native App's
  protobuf/other transports, and adaptive buffering / player-side CDN
  switching. If the player ignores backups or never calls these JSON endpoints,
  nothing changes.
- It only changes preference order; it cannot make a slow host fast.

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

## Validation

```sh
node --check accelerator.js
node --test accelerator.test.cjs
```

To verify in Surge: capture a playurl response and compare `baseUrl` with and
without the module (preferred host should be first; originals should appear in
`backupUrl`). Then play a video and check the media request host in Surge's
request viewer.
