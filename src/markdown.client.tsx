import type { PluginHostProps } from "@getpaseo/plugin";
import type Token from "markdown-it/lib/token.mjs";
import { Fragment, type ReactNode } from "react";
import { Linking, ScrollView, Text, type TextStyle, View } from "react-native";
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
  const body: TextStyle = { color: colors.foreground, fontSize: 15, lineHeight: 22 };
  const monospace = layout.platform === "ios" ? "Menlo" : "monospace";
  let remainingTokens = 5_000;

  function render(tokens: Token[]): ReactNode[] {
    let index = 0;

    function level(parent?: Token): ReactNode[] {
      const output: ReactNode[] = [];
      let listIndex = Number(parent?.attrGet("start") ?? 1);
      while (index < tokens.length) {
        if (--remainingTokens < 0) throw new Error("Markdown rendering limit exceeded");
        const key = index;
        const token = tokens[index++];
        if (token.nesting === -1) break;
        const children =
          token.nesting === 1
            ? level(token)
            : token.type === "image"
              ? []
              : render(token.children ?? []);
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
              <Text selectable style={[body, { marginVertical: token.hidden ? 0 : 5 }]}>
                {children}
              </Text>
            );
            break;
          case "heading_open": {
            const size = [26, 23, 20, 18, 16, 15][Number(token.tag.slice(1)) - 1] ?? 15;
            node = (
              <Text
                selectable
                accessibilityRole="header"
                style={[
                  body,
                  { fontSize: size, lineHeight: size + 7, fontWeight: "600", marginVertical: 8 },
                ]}
              >
                {children}
              </Text>
            );
            break;
          }
          case "strong_open":
            node = <Text style={{ fontWeight: "700" }}>{children}</Text>;
            break;
          case "em_open":
            node = <Text style={{ fontStyle: "italic" }}>{children}</Text>;
            break;
          case "s_open":
            node = <Text style={{ textDecorationLine: "line-through" }}>{children}</Text>;
            break;
          case "code_inline":
            node = (
              <Text style={{ fontFamily: monospace, backgroundColor: colors.surface2 }}>
                {token.content}
              </Text>
            );
            break;
          case "fence":
          case "code_block":
            node = (
              <View
                style={{ backgroundColor: colors.surface1, borderRadius: 6, marginVertical: 6 }}
              >
                {token.info.trim() ? (
                  <Text style={{ color: colors.foregroundMuted, fontSize: 11, padding: 8 }}>
                    {token.info.trim().split(/\s+/)[0]}
                  </Text>
                ) : null}
                <ScrollView horizontal contentContainerStyle={{ padding: 10 }}>
                  <Text selectable style={[body, { fontFamily: monospace, fontSize: 13 }]}>
                    {token.content.replace(/\n$/, "")}
                  </Text>
                </ScrollView>
              </View>
            );
            break;
          case "link_open": {
            const href = token.attrGet("href") ?? "";
            const allowed =
              /^(https?:\/\/|mailto:)/i.test(href) &&
              Array.from(href).every(
                (character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127,
              );
            node = allowed ? (
              <Text
                accessibilityRole="link"
                accessibilityHint={href}
                style={{ color: colors.accent, textDecorationLine: "underline" }}
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
              <Text style={{ color: colors.foregroundMuted }}>
                [Image: {imageDescription(token.children ?? []) || "no description"}]
              </Text>
            );
            break;
          case "blockquote_open":
            node = (
              <View
                style={{
                  borderLeftColor: colors.border,
                  borderLeftWidth: 3,
                  paddingLeft: 12,
                  marginVertical: 6,
                }}
              >
                {children}
              </View>
            );
            break;
          case "bullet_list_open":
          case "ordered_list_open":
            node = <View style={{ marginVertical: 4, gap: 4 }}>{children}</View>;
            break;
          case "list_item_open":
            node = (
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Text style={[body, { minWidth: 18, textAlign: "right" }]}>
                  {parent?.type === "ordered_list_open" ? `${listIndex++}.` : "\u2022"}
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
              <ScrollView horizontal style={{ marginVertical: 6 }}>
                <View style={{ borderWidth: 1, borderColor: colors.border }}>{children}</View>
              </ScrollView>
            );
            break;
          case "thead_open":
          case "tbody_open":
            node = <View>{children}</View>;
            break;
          case "tr_open":
            node = <View style={{ flexDirection: "row" }}>{children}</View>;
            break;
          case "th_open":
          case "td_open": {
            const alignment = token.attrGet("style");
            node = (
              <Text
                selectable
                style={[
                  body,
                  {
                    width: layout.compact ? 150 : 220,
                    padding: 8,
                    borderWidth: 0.5,
                    borderColor: colors.border,
                    backgroundColor: token.type === "th_open" ? colors.surface1 : colors.surface0,
                    fontWeight: token.type === "th_open" ? "600" : "400",
                    textAlign:
                      alignment === "text-align:right"
                        ? "right"
                        : alignment === "text-align:center"
                          ? "center"
                          : "left",
                  },
                ]}
              >
                {children}
              </Text>
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
    return <View style={{ minWidth: 0 }}>{render(markdown.parse(text, {}))}</View>;
  } catch {
    return (
      <Text selectable style={body}>
        {text}
      </Text>
    );
  }
}
