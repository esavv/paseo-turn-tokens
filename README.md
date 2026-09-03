# Paseo Token Usage

An experimental Paseo plugin that displays OpenCode token usage below assistant responses.

For each user turn, the plugin:

- sums fresh input, cache read, cache write, reasoning, and output across completed model requests;
- shows the assistant-turn number, recalculated total, and number of model requests;
- shows context-window use from the last completed request in the turn; and
- places usage details under the last text-bearing assistant message in the turn.

The plugin requires Paseo `0.7.2` or later and currently supports OpenCode agents only.

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

## Data Access

The daemon-side plugin reads OpenCode's SQLite database in read-only and query-only mode. The
default path is `~/.local/share/opencode/opencode.db`. `OPENCODE_DB` and `XDG_DATA_HOME` are
supported when present. OpenCode message data is treated as an internal interface that can change.

The displayed total is always recalculated from the five categories. Assistant-message usage and
`step-finish` usage represent the same request, so the plugin reads only assistant-message usage to
avoid duplicate accounting.

## Limitations

The timeline transformer API receives one item at a time. It does not receive the complete timeline
or the provider, so the transformer replaces every assistant message. The usage RPC runs only for
OpenCode agents.

The public plugin runtime does not expose Paseo's Markdown renderer. The replacement keeps the
original text, theme colors, content sizing, and spacing, but it displays Markdown source as plain
text. A host-provided message renderer or assistant footer slot is needed for full fidelity.

Paseo `0.7.2` does not apply plugin timeline transformers to provider-subagent tabs. Those tabs also
use a synthetic stream ID instead of a normal Paseo agent ID, so subagent usage cannot be displayed
through the current plugin API.

Assistant-message replacement also causes Paseo to alternate between its native streaming row and
a projected plugin row while text arrives. Stable query keys reduce secondary movement, but a host
footer or decorator API is required to remove the main streaming jitter without losing native
Markdown rendering.
