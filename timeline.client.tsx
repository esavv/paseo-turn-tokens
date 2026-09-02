import type { PluginTimelineItemProps } from "@getpaseo/plugin";
import { Text, View } from "react-native";
import type { z } from "zod";
import { helloAssistantSchema } from "./timeline.shared";

type HelloAssistantData = z.output<typeof helloAssistantSchema>;

export function HelloAssistantMessage({
  item,
  theme,
  layout,
}: PluginTimelineItemProps<HelloAssistantData>) {
  return (
    <View style={{ paddingVertical: layout.compact ? 8 : 12 }}>
      <Text
        selectable
        style={{
          color: theme.colors.foreground,
          fontSize: 15,
          lineHeight: 21,
        }}
      >
        {item.data.text}
      </Text>
      <Text
        style={{
          alignSelf: "flex-end",
          color: theme.colors.foregroundMuted,
          fontSize: 12,
          lineHeight: 16,
          marginTop: layout.compact ? 6 : 8,
        }}
      >
        hello
      </Text>
    </View>
  );
}
