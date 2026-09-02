# Paseo Token Usage

An initial Paseo plugin milestone that proves two client contribution points before token data is
added:

- Each assistant timeline message is replaced with a themed React Native renderer that preserves
  its text and adds `hello` at the bottom right.
- Each OpenCode agent gets a composer pill that displays `hello`.

This milestone requires Paseo `0.7.2` or later. Paseo `0.6.1` does not include timeline transformer
or composer pill contributions.

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

## Spike Findings

The timeline transformer API receives one item at a time. It does not receive the complete timeline
or an item index, so this milestone replaces every assistant message rather than only the final
assistant message.

The public plugin runtime does not expose Paseo's Markdown renderer. The replacement keeps the
original text, theme colors, content sizing, and spacing, but it displays Markdown source as plain
text. A host-provided message renderer or assistant footer slot is needed for full fidelity.
