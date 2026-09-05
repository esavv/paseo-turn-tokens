import type { PluginHostProps } from "@getpaseo/plugin";
import type Token from "markdown-it/lib/token.mjs";
import { Fragment, type ReactNode } from "react";
import { Linking, Text, type TextStyle, View } from "react-native";
import MarkdownIt from "./markdown-it.generated.js";

const markdown = new MarkdownIt({ html: false, linkify: true });

type MarkdownMessageProps = Pick<PluginHostProps, "theme" | "layout"> & { text: string };

function imageDescription(tokens: Token[]): string {
  return tokens
    .map((token) =>
      token.children
        ? imageDescription(token.children)
        : token.type === "softbreak" || token.type === "hardbreak"
          ? "\n"
          : token.content,
    )
    .join("");
}

export function MarkdownMessage({ text, theme, layout }: MarkdownMessageProps) {
  const colors = theme.colors;
  // Defaults from Paseo v0.7.2's markdown-styles.ts and appearance settings.
  // Plugin props expose colors, but not the user's content/code sizes or font choices.
  const contentSize = layout.platform === "web" ? 15 : 16;
  const body: TextStyle = {
    color: colors.foreground,
    fontSize: contentSize,
    lineHeight: Math.round(contentSize * 1.4),
    flexShrink: 1,
    minWidth: 0,
  };
  const monospace =
    layout.platform === "ios"
      ? "ui-monospace"
      : layout.platform === "web"
        ? "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
        : "monospace";
  // Paseo's web UI-font rule excludes data-pmono elements and their descendants.
  const monoProps = layout.platform === "web" ? { dataSet: { pmono: "" } } : {};
  const foregroundRgb =
    colors.foreground.length === 4
      ? `#${colors.foreground
          .slice(1)
          .split("")
          .map((digit) => digit + digit)
          .join("")}`
      : colors.foreground.slice(0, 7);
  const quoteColor = /^#[\da-f]{6}$/i.test(foregroundRgb)
    ? `${foregroundRgb}cc`
    : colors.foregroundMuted;
  const lines = text.split("\n");
  let remainingTokens = 5_000;

  function render(
    tokens: Token[],
    context: { quoted?: boolean; linked?: boolean; inListItem?: boolean } = {},
  ): ReactNode[] {
    let index = 0;

    function level(parent?: Token, inherited = context): ReactNode[] {
      const output: ReactNode[] = [];
      let listIndex = Number(parent?.attrGet("start") ?? 1);
      while (index < tokens.length) {
        if (--remainingTokens < 0) throw new Error("Markdown rendering limit exceeded");
        const key = index;
        const token = tokens[index++];
        if (token.nesting === -1) break;
        const href = token.type === "link_open" ? (token.attrGet("href") ?? "") : "";
        const allowedLink =
          /^(https?:\/\/|mailto:)/i.test(href) &&
          Array.from(href).every(
            (character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127,
          );
        const children =
          token.nesting === 1
            ? level(token, {
                quoted: inherited.quoted || token.type === "blockquote_open",
                linked: inherited.linked || allowedLink,
                inListItem: inherited.inListItem || token.type === "list_item_open",
              })
            : token.type === "image"
              ? []
              : render(token.children ?? [], inherited);
        let node: ReactNode;
        switch (token.type) {
          case "inline":
            node = children;
            break;
          case "text":
            node = token.content;
            break;
          case "softbreak":
          case "hardbreak":
            node = "\n";
            break;
          case "paragraph_open":
            node = (
              <Text
                selectable
                style={[
                  body,
                  {
                    color: inherited.quoted ? quoteColor : colors.foreground,
                    width: "100%",
                    marginTop: 0,
                    marginBottom:
                      token.hidden || (parent?.type === "list_item_open" && output.length === 0)
                        ? 0
                        : 12,
                  },
                ]}
              >
                {children}
              </Text>
            );
            break;
          case "heading_open": {
            const depth = Number(token.tag.slice(1));
            const size = Math.round(
              contentSize * (([26, 22, 20, 18, 16, 16][depth - 1] ?? 16) / 14),
            );
            node = (
              <Text
                selectable
                accessibilityRole="header"
                style={[
                  body,
                  {
                    fontSize: size,
                    lineHeight: Math.round(size * 1.3),
                    fontWeight: depth <= 2 ? "bold" : "600",
                    color: depth === 6 ? colors.foregroundMuted : colors.foreground,
                    marginTop: depth <= 2 ? 24 : depth <= 4 ? 16 : 12,
                    marginBottom: depth <= 2 ? 12 : depth <= 4 ? 8 : 4,
                    ...(depth <= 2
                      ? { borderBottomWidth: 1, borderBottomColor: colors.border, paddingBottom: 8 }
                      : {}),
                    ...(depth === 6
                      ? {
                          letterSpacing: 0.5,
                          textTransform: layout.platform === "ios" ? "none" : "uppercase",
                        }
                      : {}),
                  },
                ]}
              >
                {children}
              </Text>
            );
            break;
          }
          case "strong_open":
            node = <Text style={{ fontWeight: "500" }}>{children}</Text>;
            break;
          case "em_open":
            node = <Text style={{ fontStyle: "italic" }}>{children}</Text>;
            break;
          case "s_open":
            node = (
              <Text
                style={{
                  textDecorationLine: "line-through",
                  color: inherited.linked ? colors.accent : colors.foregroundMuted,
                }}
              >
                {children}
              </Text>
            );
            break;
          case "code_inline":
            node = (
              <Text
                {...monoProps}
                style={{
                  fontFamily: monospace,
                  fontSize: 12,
                  color: inherited.linked ? colors.accent : colors.foreground,
                  backgroundColor: colors.surface2,
                  ...(layout.platform === "web"
                    ? { paddingHorizontal: 4, paddingVertical: 2, borderRadius: 6, borderWidth: 0 }
                    : {}),
                }}
              >
                {token.content}
              </Text>
            );
            break;
          case "fence":
          case "code_block":
            node = (
              <View
                {...monoProps}
                style={{
                  backgroundColor: colors.surface2,
                  borderRadius: 6,
                  borderWidth: 1,
                  borderColor: token.type === "fence" ? colors.border : "#CCCCCC",
                  marginVertical: token.type === "fence" ? 12 : 8,
                  padding: 12,
                }}
              >
                <Text
                  selectable
                  style={[body, { fontFamily: monospace, fontSize: 12, lineHeight: 17 }]}
                >
                  {token.content.replace(/\n$/, "")}
                </Text>
              </View>
            );
            break;
          case "link_open": {
            node = allowedLink ? (
              <Text
                accessibilityRole="link"
                accessibilityHint={href}
                style={{ color: colors.accent, textDecorationLine: "none" }}
                onPress={() => {
                  void Linking.openURL(href).catch(() => {
                    // A failed external navigation must not break the assistant message.
                  });
                }}
              >
                {children}
              </Text>
            ) : (
              children
            );
            break;
          }
          case "image":
            node = (
              <Text style={{ color: inherited.linked ? colors.accent : colors.foregroundMuted }}>
                [Image: {imageDescription(token.children ?? []) || "no description"}]
              </Text>
            );
            break;
          case "blockquote_open":
            node = (
              <View
                style={{
                  backgroundColor: colors.surface1,
                  borderLeftColor: colors.surface2,
                  borderLeftWidth: 4,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: 0,
                  marginLeft: 5,
                  marginVertical: 12,
                  borderRadius: 6,
                  borderTopLeftRadius: 0,
                  borderBottomLeftRadius: 0,
                }}
              >
                {children}
              </View>
            );
            break;
          case "bullet_list_open":
          case "ordered_list_open": {
            const next = tokens[index];
            const nextIsList =
              next?.type === "bullet_list_open" || next?.type === "ordered_list_open";
            const separated = next?.map && lines[next.map[0] - 1]?.trim() === "";
            node = (
              <View
                style={{
                  paddingLeft: 0,
                  width: "100%",
                  marginTop: 4,
                  marginBottom:
                    inherited.inListItem || !next || next.nesting === -1 || (!parent && separated)
                      ? 0
                      : nextIsList
                        ? 8
                        : 16,
                }}
              >
                {children}
              </View>
            );
            break;
          }
          case "list_item_open":
            node = (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  flexShrink: 1,
                  marginBottom: 4,
                }}
              >
                <Text
                  style={[
                    body,
                    {
                      color: colors.foregroundMuted,
                      marginLeft: 10,
                      marginRight: 4,
                      ...(parent?.type === "ordered_list_open"
                        ? { minWidth: 12, fontWeight: "normal" }
                        : {}),
                    },
                  ]}
                >
                  {parent?.type === "ordered_list_open"
                    ? `${listIndex++}${parent.markup}`
                    : "\u2022"}
                </Text>
                <View style={{ flex: 1, minWidth: 0 }}>{children}</View>
              </View>
            );
            break;
          case "hr":
            node = (
              <View style={{ backgroundColor: colors.border, height: 1, marginVertical: 10 }} />
            );
            break;
          case "table_open":
            node = (
              <View
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 6,
                  marginVertical: 12,
                }}
              >
                {children}
              </View>
            );
            break;
          case "thead_open":
            node = <View style={{ backgroundColor: colors.surface2 }}>{children}</View>;
            break;
          case "tbody_open":
            node = <View>{children}</View>;
            break;
          case "tr_open":
            node = (
              <View
                style={{ flexDirection: "row", borderBottomWidth: 1, borderColor: colors.border }}
              >
                {children}
              </View>
            );
            break;
          case "th_open":
          case "td_open": {
            const alignment = token.attrGet("style");
            node = (
              <View
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: 8,
                  borderRightWidth: 1,
                  borderColor: colors.border,
                  ...(token.type === "th_open"
                    ? { borderBottomWidth: 1, backgroundColor: colors.surface2 }
                    : {}),
                }}
              >
                <Text
                  selectable
                  style={[
                    body,
                    {
                      fontWeight: token.type === "th_open" ? "600" : "normal",
                      textAlign:
                        token.type === "th_open"
                          ? "left"
                          : alignment === "text-align:right"
                            ? "right"
                            : alignment === "text-align:center"
                              ? "center"
                              : "left",
                    },
                  ]}
                >
                  {children}
                </Text>
              </View>
            );
            break;
          }
          default:
            node = children.length ? (
              children
            ) : (
              <Text selectable style={body}>
                {token.content}
              </Text>
            );
        }
        // Native assistant rows add a gap between top-level blocks split at blank lines.
        const next = tokens[index];
        if (!parent && token.map && next?.map && lines[next.map[0] - 1]?.trim() === "") {
          node = <View style={{ marginBottom: 12 }}>{node}</View>;
        }
        output.push(<Fragment key={key}>{node}</Fragment>);
      }
      return output;
    }

    return level();
  }

  // Keep very large responses readable without parsing them on every streaming update.
  if (text.length > 100_000)
    return (
      <Text selectable style={body}>
        {text}
      </Text>
    );
  try {
    return <View style={{ minWidth: 0, width: "100%" }}>{render(markdown.parse(text, {}))}</View>;
  } catch {
    return (
      <Text selectable style={body}>
        {text}
      </Text>
    );
  }
}
