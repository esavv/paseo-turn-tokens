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
  dataSet?: Record<string, string>;
  selectable?: boolean;
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
    expect(nodes.some((node) => styleOf(node).fontWeight === "500")).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontStyle === "italic")).toBe(true);
    expect(nodes.some((node) => styleOf(node).textDecorationLine === "line-through")).toBe(true);
    expect(nodes.some((node) => styleOf(node).fontFamily === "ui-monospace")).toBe(true);
  });

  it("renders nested lists with sequential numbering and blockquotes", () => {
    const tree = render("3. first\n8. second\n   - nested\n\n> quoted\n\n---");
    expect(textContent(tree)).toBe("3.first4.second\u2022nestedquoted");
    const nodes = elements(tree);
    expect(nodes.some((node) => styleOf(node).borderLeftColor === theme.colors.surface2)).toBe(
      true,
    );
    expect(nodes.some((node) => styleOf(node).height === 1)).toBe(true);
  });

  it("keeps code literal and wraps it without a language header like Paseo", () => {
    const tree = render("```ts\nconst x = '<b>&amp;</b>';\n**not bold**");
    expect(textContent(tree)).toBe("const x = '<b>&amp;</b>';\n**not bold**");
    const nodes = elements(tree);
    expect(nodes.some((node) => node.type === ScrollView)).toBe(false);
    expect(nodes.some((node) => styleOf(node).fontWeight === "500")).toBe(false);
    expect(
      nodes.some((node) => styleOf(node).fontSize === 12 && styleOf(node).lineHeight === 17),
    ).toBe(true);
  });

  it("renders native-style flexible table cells on compact and wide layouts", () => {
    for (const platform of ["ios", "web"] satisfies PluginHostProps["layout"]["platform"][]) {
      const tree = render("| Name | Count |\n| :--- | ---: |\n| **A** | 12 |", platform);
      const nodes = elements(tree);
      expect(textContent(tree)).toBe("NameCountA12");
      expect(nodes.some((node) => node.type === ScrollView)).toBe(false);
      expect(nodes.some((node) => styleOf(node).textAlign === "right")).toBe(true);
      const cells = nodes.filter((node) => styleOf(node).borderRightWidth === 1);
      expect(cells).toHaveLength(4);
      expect(cells.every((cell) => styleOf(cell).flex === 1 && styleOf(cell).padding === 8)).toBe(
        true,
      );
      expect(styleOf(cells[0])).toMatchObject({
        backgroundColor: theme.colors.surface2,
        borderBottomWidth: 1,
      });
      expect(styleOf(cells[2]).backgroundColor).toBeUndefined();
      const countHeader = nodes.find((node) => node.type === Text && textContent(node) === "Count");
      expect(countHeader).toBeDefined();
      if (countHeader) {
        expect(styleOf(countHeader)).toMatchObject({ textAlign: "left", fontWeight: "600" });
        expect(countHeader.props.selectable).toBe(true);
      }
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
          (node) =>
            styleOf(node).fontFamily ===
            (platform === "ios"
              ? "ui-monospace"
              : platform === "web"
                ? "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
                : "monospace"),
        ),
      ).toBe(true);
    }
  });

  it("matches Paseo's platform defaults for prose and inline code", () => {
    for (const platform of [
      "ios",
      "android",
      "web",
    ] satisfies PluginHostProps["layout"]["platform"][]) {
      const nodes = elements(render("Prose with `code` and **strong** and ~~deleted~~.", platform));
      const paragraph = nodes.find((node) => node.type === Text && styleOf(node).width === "100%");
      const code = nodes.find((node) => node.type === Text && styleOf(node).fontFamily);
      expect(paragraph).toBeDefined();
      expect(code).toBeDefined();
      if (!paragraph || !code) throw new Error("Missing paragraph or inline code");
      expect(styleOf(paragraph)).toMatchObject({
        fontSize: platform === "web" ? 15 : 16,
        lineHeight: platform === "web" ? 21 : 22,
        marginTop: 0,
        marginBottom: 12,
      });
      expect(styleOf(code)).toMatchObject({
        fontSize: 12,
        color: theme.colors.foreground,
        backgroundColor: theme.colors.surface2,
      });
      expect(styleOf(code).lineHeight).toBeUndefined();
      if (platform === "web") {
        expect(styleOf(code)).toMatchObject({
          paddingHorizontal: 4,
          paddingVertical: 2,
          borderRadius: 6,
          borderWidth: 0,
        });
        expect(code.props.dataSet).toEqual({ pmono: "" });
      } else {
        expect(styleOf(code).paddingHorizontal).toBeUndefined();
        expect(styleOf(code).borderRadius).toBeUndefined();
        expect(code.props.dataSet).toBeUndefined();
      }
      expect(nodes.some((node) => styleOf(node).fontWeight === "500")).toBe(true);
      expect(
        nodes.some(
          (node) =>
            styleOf(node).textDecorationLine === "line-through" &&
            styleOf(node).color === theme.colors.foregroundMuted,
        ),
      ).toBe(true);
    }
  });

  it("matches all six native and web heading tiers", () => {
    for (const platform of ["ios", "web"] satisfies PluginHostProps["layout"]["platform"][]) {
      const tree = render("# One\n## Two\n### Three\n#### Four\n##### Five\n###### Six", platform);
      const headings = elements(tree).filter((node) => node.props.accessibilityRole === "header");
      const sizes = platform === "ios" ? [30, 25, 23, 21, 18, 18] : [28, 24, 21, 19, 17, 17];
      expect(headings).toHaveLength(6);
      headings.forEach((heading, index) => {
        expect(styleOf(heading)).toMatchObject({
          fontSize: sizes[index],
          lineHeight: Math.round(sizes[index] * 1.3),
          fontWeight: index < 2 ? "bold" : "600",
          marginTop: [24, 24, 16, 16, 12, 12][index],
          marginBottom: [12, 12, 8, 8, 4, 4][index],
          color: index === 5 ? theme.colors.foregroundMuted : theme.colors.foreground,
        });
      });
      expect(styleOf(headings[0])).toMatchObject({
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        paddingBottom: 8,
      });
      expect(styleOf(headings[5])).toMatchObject({
        letterSpacing: 0.5,
        textTransform: platform === "ios" ? "none" : "uppercase",
      });
      const headingCode = elements(render("# Title `code`", platform)).find(
        (node) => styleOf(node).fontFamily,
      );
      if (!headingCode) throw new Error("Missing heading code");
      expect(styleOf(headingCode).fontSize).toBe(12);
      expect(styleOf(headingCode).fontWeight).toBeUndefined();
    }
  });

  it("matches code-block surfaces and protects their web monospace font", () => {
    const tree = render("```ts\nconst value = 1;\n```\n\n    indented", "web");
    const blocks = elements(tree).filter(
      (node) => node.type === View && node.props.dataSet?.pmono === "",
    );
    expect(blocks).toHaveLength(2);
    expect(styleOf(blocks[0])).toMatchObject({
      backgroundColor: theme.colors.surface2,
      borderWidth: 1,
      borderColor: theme.colors.border,
      borderRadius: 6,
      padding: 12,
      marginVertical: 12,
    });
    expect(styleOf(blocks[1])).toMatchObject({ borderColor: "#CCCCCC", marginVertical: 8 });
  });

  it("matches quote surfaces and inherited quote text without dimming inline code", () => {
    const tree = render("> Quote with `code`.\n>\n> Second paragraph.\n\nOutside.");
    const nodes = elements(tree);
    const quote = nodes.find((node) => styleOf(node).borderLeftWidth === 4);
    if (!quote) throw new Error("Missing blockquote");
    expect(styleOf(quote)).toMatchObject({
      backgroundColor: theme.colors.surface1,
      borderLeftColor: theme.colors.surface2,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 0,
      marginVertical: 12,
      marginLeft: 5,
      borderRadius: 6,
      borderTopLeftRadius: 0,
      borderBottomLeftRadius: 0,
    });
    const paragraphs = nodes.filter((node) => node.type === Text && styleOf(node).width === "100%");
    expect(paragraphs.map((node) => styleOf(node).color)).toEqual([
      "#eeeeeecc",
      "#eeeeeecc",
      theme.colors.foreground,
    ]);
    const code = nodes.find((node) => styleOf(node).fontFamily);
    if (!code) throw new Error("Missing quote code");
    expect(styleOf(code).color).toBe(theme.colors.foreground);
  });

  it("matches list indentation, marker colors, loose paragraphs, and delimiters", () => {
    const tree = render("3) first\n\n   continued\n\n4) second\n   - nested");
    const nodes = elements(tree);
    expect(textContent(tree)).toBe("3)firstcontinued4)second\u2022nested");
    const markers = nodes.filter((node) => node.type === Text && styleOf(node).marginLeft === 10);
    expect(markers).toHaveLength(3);
    expect(
      markers.every(
        (node) =>
          styleOf(node).marginRight === 4 && styleOf(node).color === theme.colors.foregroundMuted,
      ),
    ).toBe(true);
    expect(styleOf(markers[0])).toMatchObject({ minWidth: 12, fontWeight: "normal" });
    const paragraphs = nodes.filter((node) => node.type === Text && styleOf(node).width === "100%");
    expect(paragraphs.map((node) => styleOf(node).marginBottom)).toEqual([0, 12, 0, 0]);
  });

  it("adds native inter-block spacing only at top-level blank separators", () => {
    const spaced = elements(render("First.\n\nSecond.\n\n> Quote.\n>\n> More."));
    const gaps = spaced.filter((node) => node.type === View && styleOf(node).marginBottom === 12);
    expect(gaps).toHaveLength(2);
    const adjacent = elements(render("# Heading\nParagraph."));
    expect(adjacent.some((node) => node.type === View && styleOf(node).marginBottom === 12)).toBe(
      false,
    );
  });

  it("uses the available accent color without permanently underlining links", () => {
    const link = elements(render("[Paseo](https://paseo.sh)")).find(
      (node) => node.props.accessibilityRole === "link",
    );
    if (!link) throw new Error("Missing link");
    expect(styleOf(link)).toMatchObject({ color: theme.colors.accent, textDecorationLine: "none" });
  });

  it("keeps styled link labels visibly linked, but does not color blocked links as active", () => {
    const nodes = elements(
      render("[`code` and ~~old~~](https://paseo.sh) and [`file`](./file.ts)"),
    );
    const styledLabels = nodes.filter(
      (node) => styleOf(node).fontFamily || styleOf(node).textDecorationLine === "line-through",
    );
    expect(styledLabels.map((node) => styleOf(node).color)).toEqual([
      theme.colors.accent,
      theme.colors.accent,
      theme.colors.foreground,
    ]);
  });

  it("does not add list-bottom spacing through an intervening blockquote", () => {
    const nodes = elements(render("- outer\n\n  > - inner\n  >\n  > after"));
    const lists = nodes.filter(
      (node) =>
        node.type === View && styleOf(node).paddingLeft === 0 && styleOf(node).width === "100%",
    );
    expect(lists).toHaveLength(2);
    expect(lists.map((node) => styleOf(node).marginBottom)).toEqual([0, 0]);
  });
});
