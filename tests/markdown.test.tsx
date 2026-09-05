import type { PluginHostProps } from "@getpaseo/plugin";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { Linking, ScrollView, Text, type TextStyle, View } from "react-native";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownMessage } from "../src/markdown.client";
import MarkdownIt from "../src/markdown-it.generated.js";

vi.mock("react-native", () => ({
  Text: "Text",
  View: "View",
  ScrollView: "ScrollView",
  Linking: { openURL: vi.fn().mockResolvedValue(undefined) },
}));

const theme: PluginHostProps["theme"] = {
  colors: {
    foreground: "#eeeeee",
    foregroundMuted: "#aaaaaa",
    surface0: "#111111",
    surface1: "#222222",
    surface2: "#333333",
    border: "#444444",
    accent: "#88aaff",
    accentForeground: "#ffffff",
    statusSuccess: "#008800",
    statusWarning: "#888800",
    statusDanger: "#880000",
  },
};

interface ElementProps {
  children?: ReactNode;
  style?: TextStyle | TextStyle[];
  accessibilityRole?: string;
  horizontal?: boolean;
  onPress?: () => void;
}

function elements(node: ReactNode): ReactElement<ElementProps>[] {
  const result: ReactElement<ElementProps>[] = [];
  Children.forEach(node, (child) => {
    if (isValidElement<ElementProps>(child)) {
      result.push(child, ...elements(child.props.children));
    }
  });
  return result;
}

function textContent(node: ReactNode): string {
  let result = "";
  Children.forEach(node, (child) => {
    if (typeof child === "string" || typeof child === "number") result += child;
    else if (isValidElement<ElementProps>(child)) result += textContent(child.props.children);
  });
  return result;
}

function styleOf(element: ReactElement<ElementProps>): TextStyle {
  return Object.assign({}, ...[element.props.style].flat());
}

function render(text: string, platform: PluginHostProps["layout"]["platform"] = "ios") {
  return MarkdownMessage({ text, theme, layout: { platform, compact: platform !== "web" } });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("assistant Markdown", () => {
  it("formats headings, emphasis, entities, inline code, and line breaks", () => {
    const tree = render("# Title\n\n**Bold** and *italic* and ~~old~~ &amp; `a < b`  \nnext");
    const nodes = elements(tree);
    expect(textContent(tree)).toBe("TitleBold and italic and old & a < b\nnext");
    expect(nodes.some((node) => node.props.accessibilityRole === "header")).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontWeight === "700")).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontStyle === "italic")).toBe(true);
    expect(nodes.some((node) => styleOf(node).textDecorationLine === "line-through")).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontFamily === "Menlo")).toBe(true);
  });

  it("renders nested lists with sequential numbering and blockquotes", () => {
    const tree = render("3. first\n8. second\n   - nested\n\n> quoted\n\n---");
    expect(textContent(tree)).toBe("3.first4.second\u2022nestedquoted");
    const nodes = elements(tree);
    expect(nodes.some((node) => styleOf(node).borderLeftColor === theme.colors.border)).toBe(true);
    expect(nodes.some((node) => styleOf(node).height === 1)).toBe(true);
  });

  it("keeps code literal, scrollable, and readable while a fence is incomplete", () => {
    const tree = render("```ts\nconst x = '<b>&amp;</b>';\n**not bold**");
    expect(textContent(tree)).toBe("tsconst x = '<b>&amp;</b>';\n**not bold**");
    const nodes = elements(tree);
    expect(nodes.some((node) => node.type === ScrollView && node.props.horizontal)).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontWeight === "700")).toBe(false);
  });

  it("renders aligned tables with horizontal scrolling on compact and wide layouts", () => {
    for (const platform of ["ios", "web"] satisfies PluginHostProps["layout"]["platform"][]) {
      const tree = render("| Name | Count |\n| :--- | ---: |\n| **A** | 12 |", platform);
      const nodes = elements(tree);
      expect(textContent(tree)).toBe("NameCountA12");
      expect(nodes.some((node) => node.type === ScrollView && node.props.horizontal)).toBe(true);
      expect(nodes.some((node) => styleOf(node).textAlign === "right")).toBe(true);
      expect(nodes.some((node) => styleOf(node).width === (platform === "ios" ? 150 : 220))).toBe(
        true,
      );
    }
  });

  it("opens permitted links only after a press", () => {
    const tree = render("[Paseo](https://paseo.sh) and <hello@example.com> and http://example.com");
    const links = elements(tree).filter((node) => node.props.accessibilityRole === "link");
    expect(links).toHaveLength(3);
    expect(Linking.openURL).not.toHaveBeenCalled();
    for (const link of links) link.props.onPress?.();
    expect(Linking.openURL).toHaveBeenCalledWith("https://paseo.sh");
    expect(Linking.openURL).toHaveBeenCalledWith("mailto:hello@example.com");
    expect(Linking.openURL).toHaveBeenCalledWith("http://example.com");
  });

  it("does not execute HTML, open unsafe links, or download images", () => {
    const tree = render(
      "<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [encoded](java&#x73;cript:alert%281%29) [file](file:///etc/passwd) [relative](./file.ts) [data](data:text/html,test) ![Alt](https://example.com/image.png)",
    );
    expect(textContent(tree)).toContain("<script>alert(1)</script>");
    expect(textContent(tree)).toContain("[Image: Alt]");
    expect(elements(tree).some((node) => node.props.onPress)).toBe(false);
    expect(Linking.openURL).not.toHaveBeenCalled();
  });

  it("handles failed external navigation without rejecting into the timeline", async () => {
    vi.mocked(Linking.openURL).mockRejectedValueOnce(new Error("No handler"));
    const link = elements(render("[Paseo](https://paseo.sh)")).find((node) => node.props.onPress);
    expect(link).toBeDefined();
    link?.props.onPress?.();
    await Promise.resolve();
  });

  it("uses decoded image descriptions without interactive content", () => {
    const tree = render("![*hello* &amp; `code` \\*literal\\*](https://example.com/image.png)");
    expect(textContent(tree)).toBe("[Image: hello & code *literal*]");
    expect(elements(tree).some((node) => node.props.onPress)).toBe(false);
  });

  it("falls back for short tables that expand into too many native views", () => {
    const source = `|${"x|".repeat(256)}\n|${"-|".repeat(256)}\n${"x\n".repeat(256)}`;
    const tree = render(source);
    expect(textContent(tree)).toBe(source);
    expect(elements(tree)).toHaveLength(1);
  });

  it("never puts a native block view inside a Text component", () => {
    const tree = render(
      "# Heading\n\nParagraph **bold *nested*** ![image](https://example.com/a)\n\n> - list\n>   - nested\n\n```\ncode\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |",
    );
    for (const node of elements(tree).filter((element) => element.type === Text)) {
      expect(
        elements(node.props.children).some(
          (child) => child.type === View || child.type === ScrollView,
        ),
      ).toBe(false);
    }
  });

  it("keeps earlier sibling keys stable as a response grows", () => {
    const before = elements(render("First paragraph.\n\nSecond"));
    const after = elements(render("First paragraph.\n\nSecond paragraph grows."));
    expect(before.map((node) => node.key)).toEqual(after.map((node) => node.key));
  });

  it("handles every prefix of a streaming response", () => {
    const source =
      "# Title\n\n**Bold** [link](https://paseo.sh)\n\n- item\n\n```ts\nconst x = 1;\n```";
    for (let end = 0; end <= source.length; end++) {
      expect(() => render(source.slice(0, end))).not.toThrow();
    }
  });

  it("falls back to all source text if parsing fails or a response is very large", () => {
    const parse = vi.spyOn(MarkdownIt.prototype, "parse").mockImplementation(() => {
      throw new Error("Parser failed");
    });
    const source = "**Keep this response**";
    expect(textContent(render(source))).toBe(source);
    const large = "a".repeat(100_001);
    expect(textContent(render(large))).toBe(large);
    expect(parse).toHaveBeenCalledTimes(1);
  });

  it("uses host colors and platform-specific monospace fonts", () => {
    for (const platform of [
      "ios",
      "android",
      "web",
    ] satisfies PluginHostProps["layout"]["platform"][]) {
      const nodes = elements(render("Paragraph\n\n`code`\n\n```\nblock\n```", platform));
      expect(nodes.some((node) => styleOf(node).color === theme.colors.foreground)).toBe(true);
      expect(
        nodes.some(
          (node) => styleOf(node).fontFamily === (platform === "ios" ? "Menlo" : "monospace"),
        ),
      ).toBe(true);
    }
  });
});
