# kanashi

Python CLI for constructing and submitting Discord game activity events. Requires Python 3.10+ and uses only the standard library. Badge changes are not verified by the local tests and depend on Discord's behavior.

## Run

```sh
python3 spoofer.py
python3 spoofer.py --workers 2 --cookies /path/to/cookies.json
python3 spoofer.py --help
```

The source entry point remains `spoofer.py` for compatibility. The CLI and release executable are named `kanashi`. There are no subscription, Discord invite, browser-opening or countdown requirements.

The first launch asks for an account token and cookies. Local authentication state is stored in `science_state.json`, which is ignored by Git. This file contains sensitive credentials: do not share it or include it in an environment snapshot. Tokens and cookies are sent to Discord for authentication; they are not included in debug logs.

## Cookie import

Paste a Cookie header or one-line JSON at the cookie prompt, or pass a UTF-8 file using `--cookies`:

```sh
python3 spoofer.py --cookies /path/to/cookies.txt
```

Supported formats:

- Cookie header, optionally prefixed with `Cookie:`.
- JSON cookie array, an object containing a `cookies` array, a single cookie object, or a map of cookie names to values.
- Netscape cookies.txt, including `#HttpOnly_` entries.

Only `cf_clearance` is retained. For exports containing domain metadata, only `discord.com` and `www.discord.com` entries are accepted. Missing or conflicting clearance values are rejected without replacing the saved cookie. This imports an existing cookie; it does not generate clearance or solve a Cloudflare challenge. Clearance may be tied to the browser, user agent and IP that obtained it, and may expire.

## Concurrency and proxy

`--workers 1-8` sets bounded concurrency (default: 1). All workers share the existing one-second interval between request starts. Sequence numbers are generated on the main thread. Authentication rejection (`401`/`403`) or rate limiting (`429`) stops new submissions; already running requests may finish. Requests are not automatically retried, because a retry could duplicate events.

One HTTP(S) proxy can be configured with `--proxy http://host:port` or the `KANASHI_PROXY` environment variable. Optional URL authentication is supported. Prefer the environment variable for private proxy credentials so they do not appear in shell history. SOCKS and rotating proxy lists are not supported. With no explicit proxy, Python's system/environment proxy settings remain active.

The same proxy configuration is used for authentication, analytics, game data and optional client properties. TLS certificate verification remains enabled. A proxy change may invalidate clearance obtained on another IP.

## Menu

1. Claim games: choose the game count and hours per game.
2. Refresh authentication and optionally replace cookies.
3. Generate an executable fingerprint (Windows only).
4. Exit.
5. Resume the saved run.

The game cache is `/workspace/data/games.json` when the checkout is `/workspace/discord-badge-spoofer`; otherwise it is `data/games.json` next to the checkout directory. Missing data is fetched from `cdn.discordapp.com`. Authentication and analytics use `discord.com`. Client properties optionally use `cordapi.dolfi.es`, with a local fallback.

## Offline preview

```sh
python3 spoofer.py --dry-run --games-file tests/fixtures/games.json --count 2 --hours 1
```

The included catalog contains synthetic examples for offline testing only. For a preview using actual games, point `--games-file` at an existing local game catalog. Without that flag, dry-run reads the existing game cache; it never downloads a missing cache.

Dry-run prints event JSON without authentication credentials, reads no account state and makes no network requests. It does not change statistics or progress. `--cookies` and an explicit `--proxy` cannot be combined with it. `--count`, `--hours` and `--games-file` are preview-only options; live runs ask for count and hours in the menu.

Counts must be positive integers within the available catalog. Hours must be finite and positive, represent at least one millisecond, and not backdate before 1970. Invalid inputs are rejected before authentication or progress changes.

## Saved progress

Live runs persist a per-game delivery journal in `science_state.json`. Each accepted (`204`) batch updates totals and used-game history immediately. Selecting games alone does not update history. Writes use an atomic replacement so an interrupted write preserves the previous file.

Press Ctrl+C during a run to stop new work and wait for in-flight requests to finish (up to their network timeouts). Their results are recorded before returning to the menu. Choose **5** to resume pending games and batches explicitly rejected with `401`, `403` or `429`; refresh authentication first if needed. Resume retains the saved game list and hours per game. Accepted batches are excluded.

A network failure, other unexpected HTTP result, or process termination during delivery leaves the result **uncertain**. Such entries are excluded from resume to avoid duplicate submissions. There is no exactly-once delivery guarantee: a request may reach the server just before its response or local acknowledgement is lost. Counts represent acknowledged requests, not confirmed badge changes. Starting a new run while an unfinished journal exists requires an explicit replacement confirmation.

## Experimental Streaming telemetry probe

A separate [stream_experiment.py](stream_experiment.py) command constructs the stream analytics sequence for an offline preview:

```sh
python3 stream_experiment.py --guild-id 123456789012345678 --channel-id 123456789012345679 --hours 1
```

The preview reads no account state and sends no network traffic. To try **one** live telemetry batch, use your own guild and voice channel IDs and add `--send`. Live mode reads `science_state.json` for a previously entered token and `cf_clearance`, obtains an analytics token, and posts to Discord's `/science` endpoint. It prints only the HTTP status. Do not copy credentials into shell commands or share the state file. The experimental script is not packaged in the Windows release executable.

This sequence was informed by the public [discord-streamer](https://github.com/lawerth/discord-streamer) experiment. That project also runs an actual WebRTC broadcast and a viewer; this probe does **not**. A `204` response establishes only that Discord accepted the telemetry request. It does not establish that Streaming badge hours increased. No authenticated test or badge-progress comparison was possible during development. Discord's [official badge guide](https://support.discord.com/hc/en-us/articles/44369363856663-Discord-Profile-Badges-What-Each-Badge-Means) says time counts while a Discord desktop stream has at least one other person in the call, with activity-personalization enabled. The offline probe does not meet those conditions.

## Discord desktop console experiment

[stream_console.js](stream_console.js) is a single-file JavaScript version of the Streaming telemetry probe for the Discord desktop client developer console. It uses the client’s existing authenticated REST session, so no account token is pasted into the script. Join a server voice channel first; the script reads its channel and guild IDs from Discord’s current voice state. Edit `hours` at the top if needed. Set `dryRun: true` for an offline preview; the provided file has `dryRun: false` and posts one batch when pasted into the console. Do not paste scripts from untrusted sources into a logged-in client.

This is a telemetry experiment only. It creates no voice/stream session, WebRTC media, or viewer. A resolved request or HTTP `204` does not establish that badge time increased. The official Discord badge criteria still apply. There is no automatic repeat or claim of success in the script.

## Validation

```sh
python3 -m unittest discover -s tests -v
```

Tests cover cookie parsing, proxy routing configuration, bounded concurrency and shared pacing, stop behavior, sequence generation, legacy state compatibility, CLI startup, offline preview, input validation, atomic journal writes, progress recovery, and the offline Streaming telemetry probe. HTTP behavior is mocked; tests do not authenticate an account or submit live analytics. The release workflow builds a Windows executable; Linux supports the CLI but cannot generate Windows executable fingerprints.

Submitting fabricated activity violates Discord's terms and may affect the account. Use only accounts you are authorized to control.

## License

MIT; see [LICENSE](LICENSE). The original copyright notice is retained as required by the license.
