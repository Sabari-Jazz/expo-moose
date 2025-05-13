import { Text, type TextProps, StyleSheet } from "react-native";

import { useThemeColor } from "@/hooks/useThemeColor";
import { Colors } from "@/constants/Colors";

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?:
    | "default"
    | "title"
    | "subtitle"
    | "heading"
    | "subheading"
    | "body"
    | "caption"
    | "link"
    | "error"
    | "success";
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = "default",
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, "text");
  const linkColor = useThemeColor({}, "link");

  return (
    <Text
      style={[
        {
          color:
            type === "link"
              ? linkColor
              : type === "error"
              ? Colors.light.statusBarError
              : type === "success"
              ? Colors.light.statusBarSuccess
              : color,
        },
        type === "default" ? styles.default : undefined,
        type === "title" ? styles.title : undefined,
        type === "subtitle" ? styles.subtitle : undefined,
        type === "heading" ? styles.heading : undefined,
        type === "subheading" ? styles.subheading : undefined,
        type === "body" ? styles.body : undefined,
        type === "caption" ? styles.caption : undefined,
        type === "link" ? styles.link : undefined,
        type === "error" ? styles.error : undefined,
        type === "success" ? styles.success : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    lineHeight: 40,
    marginVertical: 8,
  },
  subtitle: {
    fontSize: 22,
    fontWeight: "600",
    lineHeight: 28,
    marginVertical: 6,
  },
  heading: {
    fontSize: 20,
    fontWeight: "bold",
    lineHeight: 26,
    marginVertical: 6,
  },
  subheading: {
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 24,
    marginVertical: 4,
  },
  body: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "400",
  },
  caption: {
    fontSize: 14,
    lineHeight: 18,
    fontWeight: "400",
    opacity: 0.8,
  },
  link: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
    textDecorationLine: "underline",
  },
  error: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },
  success: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },
});
