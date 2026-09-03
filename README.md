# Paseo Token Usage

An experimental Paseo plugin that displays OpenCode token usage below assistant turns. It requires
Paseo `0.7.2` or later.

## How It Works

The plugin registers a **timeline transformer** for projected `assistant_message` entries and a
versioned **timeline renderer** for its output. In Paseo's terminology, the transformer replaces a
projected timeline entry with a **plugin timeline item**. "Timeline replacement" describes the
effect; "timeline transformer" and "timeline renderer" are the public API names.

The replacement keeps the original assistant message ID and text. Its renderer reproduces the text,
loads usage through typed plugin RPC, and adds an expandable token summary. Details are expanded by
default and can be collapsed to one line. Wide layouts use two detail lines. Compact layouts use
three lines and shorter `in` and `out` labels.

The daemon-side RPC maps the Paseo agent to its OpenCode session and reads completed assistant
messages from OpenCode's SQLite database. For each assistant turn, the plugin:

- groups model requests by their user-message parent ID;
- sums fresh input, cache read, cache write, reasoning, and output across completed requests;
- recalculates the total from those five categories;
- reports the number of model requests in the turn;
- uses the last completed request for context-window use; and
- attaches the aggregate to the last text-bearing assistant message in the turn.

One assistant turn can contain several model requests, such as a tool loop. The current display is
therefore turn-level, not model-request-level.

## Data Access

The plugin backend opens OpenCode's database in read-only mode and enables SQLite query-only mode.
The default path is `~/.local/share/opencode/opencode.db`. `OPENCODE_DB` and `XDG_DATA_HOME` are
supported when present.

OpenCode assistant-message usage and `step-finish` usage represent the same request. The plugin
reads only assistant-message usage to prevent duplicate accounting. Usage becomes available only
after a model request completes.

OpenCode's database tables and message JSON are internal interfaces and can change without notice.

## Limitations

### Replacement Scope

A timeline transformer receives one selected projected item at a time. It does not receive the
agent ID, provider, turn, neighboring items, or complete timeline. This plugin must therefore
replace every normal assistant message. The renderer requests usage only for OpenCode agents, but a
non-OpenCode assistant message has already been replaced before that check occurs.

Paseo `0.7.2` does not apply timeline transformers to provider-native subagent timelines. Those
timelines also use synthetic stream IDs instead of normal Paseo agent IDs, so the current usage RPC
cannot query them.

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
model identity, and all five token categories so the plugin can stop polling OpenCode's database.

### Native Fallback

Paseo should retain the original projected entry when a transformer replaces it. If the plugin,
renderer, schema, or runtime is unavailable, Paseo could render the original entry instead of the
generic unavailable message. Persisting the last accepted plugin client bundle would also permit
the enhanced item to render after a cold offline start.

### Transformer Context

Provider or agent context in the timeline transformer input would let this plugin leave non-OpenCode
assistant messages unchanged.

## Development

```sh
npm install
npm run typecheck
npm test
```

Install or reload the plugin on the daemon machine:

```sh
paseo plugin install /Users/eriksavage/Projects/paseo-token-usage
paseo plugin reload paseo-token-usage
paseo plugin logs paseo-token-usage
```

Paseo's global plugin switch must also be enabled in **Settings > Plugins**.
