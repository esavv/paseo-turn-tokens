# turn-tokens

Token usage for each assistant turn and compaction event in your Paseo agent timeline.
Supports Claude Code, Codex, OpenCode, and Pi.

https://github.com/user-attachments/assets/158e1c96-9716-4170-b014-fd0f02c86d40

Compaction display:

<img width="885" height="267" alt="Screenshot-2026-09-05-3 41 51-PM-compaction-only" src="https://github.com/user-attachments/assets/7d7575ef-bf41-44c3-902c-240f5379a04c" />

## Install

Enable plugins under **Settings > Plugins** on the daemon, then install from GitHub:

```sh
paseo plugin add esavv/paseo-turn-tokens
```

## Development

```sh
npm install
npm run format:check
npm run lint
npm run typecheck
npm test
```

Install or reload the plugin on the daemon machine:

```sh
paseo plugin install /absolute/path/to/paseo-turn-tokens
paseo plugin reload turn-tokens
paseo plugin logs turn-tokens
```

## Security and Privacy

Paseo plugins are trusted code. This plugin's server code runs unsandboxed with the daemon user's
access and reads local Claude Code, Codex, OpenCode, and Pi session data. Provider files and
databases are opened read-only; the plugin does not modify them or make external network requests.

The plugin sends normalized token counts, response identifiers, context limits, and model-change
metadata to connected Paseo clients through its plugin RPC. It does not send transcript text or
provider credentials through that RPC.

## How It Works

The plugin registers **timeline transformers** for projected `assistant_message` and `compaction`
entries and versioned **timeline renderers** for their output. In Paseo's terminology, a transformer
replaces a projected timeline entry with a **plugin timeline item**. "Timeline replacement"
describes the effect; "timeline transformer" and "timeline renderer" are the public API names.

The replacement keeps the original assistant message ID and text. Its renderer reproduces the text,
loads usage through typed plugin RPC, and adds an expandable token summary. Details are expanded by
default and can be collapsed to one line. Wide layouts use two detail lines. Compact layouts use
three lines and shorter `in` and `out` labels.

The daemon-side RPC maps the Paseo agent to its provider session and reads completed model requests
from the provider's local data. For each assistant turn, the plugin:

- groups model requests by the provider's user turn or turn ID;
- deduplicates repeated and cumulative provider records;
- normalizes fresh input, cache read, cache write, reasoning, and output into disjoint categories;
- sums those categories across completed requests;
- recalculates the total from those five categories;
- reports the number of model requests in the turn;
- flags a model change from the preceding completed assistant turn;
- uses the last completed request for context-window use; and
- attaches the aggregate to the last text-bearing assistant message in the turn.

One assistant turn can contain several model requests, such as a tool loop. The current display is
therefore turn-level, not model-request-level. When the final request model differs from the
preceding assistant turn, the expanded details show the old and new model IDs on a final row.

## Supported Providers

### Claude Code

Claude transcripts are stored at:

```text
~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

The plugin supports `CLAUDE_CONFIG_DIR` and `CLAUDE_CODE_PROJECT_DIR_NAME`. One API response can be
stored as separate thinking, tool-use, and text rows with the same usage. The plugin deduplicates
those rows by request and API message ID. It also keeps both Claude's transcript UUID and API
message ID because Paseo can use either one for the same visible response.

Claude's transcript format is an internal interface and can change without notice. See the
[Claude Code session documentation](https://code.claude.com/docs/en/sessions) and
[cost documentation](https://code.claude.com/docs/en/costs).

### Codex

Codex rollouts are stored at:

```text
$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread-id>.jsonl
```

`CODEX_HOME` defaults to `~/.codex`. The plugin first looks up `rollout_path` in Codex's read-only
`state_*.sqlite` database, including a separate `CODEX_SQLITE_HOME` when configured. It then falls
back to scanning active and archived rollout directories.

Current rollouts contain one `token_usage_record` delta per completed model response and cumulative
turn and thread snapshots. The plugin reads only the deltas. Older rollouts that contain only
`token_count` events use `last_token_usage`, not the cumulative total. Response IDs prevent duplicate
accounting, and rollback records remove discarded turns.

Codex's rollout and database formats are internal interfaces and can change without notice. See the
[Codex CLI documentation](https://learn.chatgpt.com/docs/codex/cli) and
[Codex source](https://github.com/openai/codex).

### OpenCode

The plugin opens OpenCode's database in read-only mode and enables SQLite query-only mode. The
default path is `~/.local/share/opencode/opencode.db`. `OPENCODE_DB` and `XDG_DATA_HOME` are
supported when present.

OpenCode assistant-message usage and `step-finish` usage represent the same request. The plugin
reads only assistant-message usage to prevent duplicate accounting. Usage becomes available only
after a model request completes.

OpenCode's database tables and message JSON are internal interfaces and can change without notice.

### Pi

Pi sessions are stored at:

```text
~/.pi/agent/sessions/--<encoded-project>--/<timestamp>_<session-id>.jsonl
```

Paseo persists Pi's full session-file path, which the plugin uses when available. Discovery also
supports `PI_CODING_AGENT_DIR`, `PI_CODING_AGENT_SESSION_DIR`, and project or global Pi settings.
The plugin follows the active branch represented by the final persisted entry and applies Pi's
compaction rules. Assistant turns include usage from assistant messages, nested tool-result model
work, and branch summaries. Compaction usage is shown at its separate timeline marker.

Pi documents its JSONL structure in the
[session format reference](https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/docs/session-format.md).

### Compaction Usage

Provider-local data does not expose compaction-summary usage consistently. These results apply to
Claude Code `2.1.259`, Codex `0.153.0`, OpenCode `1.18.27`, and Pi `0.84.4`:

| Provider    | Attributable usage | Stored data                                                                                                                                                                                                                                                                                                                                              |
| ----------- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude Code | No                 | Anthropic's server-side [Messages API compaction beta](https://platform.claude.com/docs/en/build-with-claude/compaction#understanding-usage) returns per-iteration compaction usage. Claude Code does not persist that usage in its local transcript or expose it to `PostCompact` hooks. Session totals can include the request without identifying it. |
| Codex       | Yes                | A `token_usage_record` identifies the compaction response, and the `compacted` record refers to the same response ID.                                                                                                                                                                                                                                    |
| OpenCode    | Yes                | The token-bearing summary assistant message refers to the message that contains the compaction part.                                                                                                                                                                                                                                                     |
| Pi          | Yes                | `compaction` entries store summary-generation `usage` separately from `tokensBefore`; split compactions can combine two summary requests.                                                                                                                                                                                                                |

The plugin replaces the native compaction marker to show the available Codex, OpenCode, and Pi data
in the same expandable format as assistant-turn usage. Paseo `0.7.2` has no additive timeline render
slot, so the plugin must reproduce the native marker instead of keeping it and adding usage after it.

Paseo emits OpenCode compaction markers during a live session, but its production OpenCode
`streamHistory()` path does not replay persisted compaction parts. A cold history rebuild or clean
import can therefore omit those markers even though OpenCode still stores the compaction and its
usage. The plugin can replace a marker that Paseo supplies, but the timeline transformer API cannot
insert a missing marker at its original position. The plugin's usage RPC can still read the stored
compaction data. This is a Paseo history-replay limitation rather than lost OpenCode data.

## Token Categories

The five displayed categories are disjoint, even when a provider reports overlapping fields:

- `input` is non-cached input;
- `cache read` is cached input;
- `cache write` is input written to a provider cache;
- `reasoning` is the reported thinking or reasoning subset of output; and
- `output` is the remaining non-reasoning output.

For Claude, Codex, and Pi, reported reasoning is already included in native output. For Codex,
cached input is also included in native input. The plugin subtracts those subsets before it adds the
five displayed categories. This keeps the displayed total equal to the provider's full token total.

## Cursor

Cursor is not supported. Normal Cursor CLI and editor session files on macOS do not contain a
documented, usable per-session token breakdown. Cursor now exposes token usage for agents started
through its [TypeScript SDK](https://cursor.com/docs/sdk/typescript#token-usage), and account-gated
Admin or OpenTelemetry interfaces can expose other usage data. Those sources do not recover token
counts for an existing normal local Cursor session, and Paseo's Cursor ACP provider does not expose
them to this plugin. Reading opaque Cursor databases would depend on an undocumented format, so the
plugin does not do it.

## Limitations

### Replacement Scope

A timeline transformer receives one selected projected item at a time. It does not receive the
agent ID, provider, turn, neighboring items, or complete timeline. This plugin must therefore
replace every normal assistant message. The renderer requests usage only for Claude Code, Codex,
OpenCode, and Pi agents, but an unsupported provider's assistant message has already been replaced
before that check occurs.

Paseo `0.7.2` does not expose a plugin extension point in provider-native subagent timelines. Their
separate timeline path does not apply timeline transformers or produce plugin timeline items. Those
timelines also use synthetic stream IDs instead of normal Paseo agent IDs, so the current usage RPC
cannot query them. Plugin features outside the subagent timeline are not affected.

### Provider State

Claude sidechain responses are not included because Paseo does not transform provider-native
subagent timelines.

Pi does not persist an in-memory branch selection until another entry is appended. After a rewind,
usage can temporarily follow the previously persisted branch. Also, when a Pi response has no
`responseId`, Paseo uses a random message ID for the live row and a deterministic ID after history is
rebuilt. Usage for that uncommon response cannot attach to the live row, but it can attach after the
history rebuild.

### Native Rendering

Timeline transformation is replacement, not decoration. A plugin cannot keep Paseo's native
assistant message and append content to it. The replacement displays the original message as plain,
selectable text and uses Paseo theme colors and compact-layout information, but it does not retain:

- Markdown rendering and Markdown-aware copying;
- code-block presentation and copy actions;
- links, file navigation, and Markdown images;
- paced streaming text;
- native assistant grouping and spacing; or
- the assistant-turn footer, including copy and fork actions, duration, and completion time.

### Streaming

Paseo first renders a matching live event as a native row, then refreshes the projected tail and
applies the plugin replacement. This can cause visible row movement while assistant text streams.
Changing projected message text can also remount the plugin item and reset its local disclosure
state.

Paseo normally merges a native compaction's loading and completed events into one row. Timeline
replacement removes the native compaction identity used for that merge. The plugin hides a stale
loading replacement when completed usage appears or the agent becomes idle, so the completed marker
is the only row that remains.

### Offline Use

Paseo stores the plugin timeline item in its local timeline cache, but it does not store the original
projected entry or the plugin client bundle with that item. It also removes the host's installed
plugin renderers from the client registry when the host disconnects. The cached replacement then
shows `Plugin timeline item unavailable` instead of the original assistant message.

The renderer already carries the original text and can work without token data, but Paseo does not
mount it while the plugin installation is unavailable. This cannot be fixed by the plugin while it
uses timeline replacement.

## Feature Requests

### Assistant-Turn Footer Slot

Mo, a Paseo maintainer, suggested a plugin render slot after agent turns. A public,
plugin-capable assistant-turn footer slot would let this plugin append aggregated usage while Paseo
keeps ownership of the native message renderer. This would address most rendering, streaming, and
fallback problems caused by replacement.

### Per-Model-Request Slot

A turn can contain several model requests. A public per-model-request render slot would let this
plugin show each request's tokens at the point where that request completes instead of combining all
requests into one turn aggregate. A matching public usage event should include request identity,
model identity, and all five token categories so the plugin can stop polling provider data.

### Post-Compaction Slot

A public render slot immediately after each native compaction marker would let plugins show the
summary request's usage without replacing the marker. The slot should provide the normal agent
context and enough compaction identity to match provider data. Codex, OpenCode, and Pi can supply
this usage today; Claude Code would remain unavailable until its transcript stores attributable
usage.

### Subagent Timeline Slots

Provider-native subagent sessions need plugin render slots too. Paseo `0.7.2` uses a separate,
read-only timeline path for these sessions and does not apply the main-session timeline transformer
or renderer system there. Supporting the same assistant-turn, model-request, and post-compaction
slots in main and subagent timelines would let plugins present data consistently without requiring
replacement support in subagent sessions.

### Native Fallback

Paseo should retain the original projected entry when a transformer replaces it. If the plugin,
renderer, schema, or runtime is unavailable, Paseo could render the original entry instead of the
generic unavailable message. Persisting the last accepted plugin client bundle would also permit
the enhanced item to render after a cold offline start.

### Transformer Context

Provider or agent context in the timeline transformer input would let this plugin leave unsupported
assistant messages unchanged.
