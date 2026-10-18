export const colorTokens = [
  { name: "背景", variable: "--background", light: "#F5F9FF", dark: "#0B1018" },
  { name: "次级背景", variable: "--secondary", light: "#EEF4FF", dark: "#111B29" },
  { name: "内容表面", variable: "--card", light: "#FFFFFF", dark: "#141E2B" },
  { name: "浮层表面", variable: "--surface-raised", light: "#FFFFFF", dark: "#1A2738" },
  { name: "主文字", variable: "--foreground", light: "#0F172A", dark: "#EDF3FC" },
  { name: "次文字", variable: "--muted-foreground", light: "#475569", dark: "#A8B6CB" },
  { name: "边框", variable: "--border", light: "#DCE7F8", dark: "#2B3B52" },
  { name: "主按钮", variable: "--primary", light: "#1264D9", dark: "#1264D9" },
  { name: "品牌蓝", variable: "--brand", light: "#1677FF", dark: "#1677FF" },
  { name: "链接", variable: "--link", light: "#0F4FCC", dark: "#91BEFF" },
  { name: "键盘焦点", variable: "--ring", light: "#1677FF", dark: "#78ACFF" },
  { name: "图表线条", variable: "--chart-line", light: "#1264D9", dark: "#78ACFF" },
] as const;

export const typographyTokens = [
  { name: "Display", variable: "--text-display", size: 64, weight: 600, lineHeight: 1.1 },
  { name: "Title", variable: "--text-title", size: 40, weight: 600, lineHeight: 1.2 },
  { name: "Heading", variable: "--text-heading", size: 28, weight: 600, lineHeight: 1.3 },
  { name: "Subheading", variable: "--text-subheading", size: 20, weight: 600, lineHeight: 1.4 },
  { name: "Body", variable: "--text-body", size: 16, weight: 400, lineHeight: 1.6 },
  { name: "Small", variable: "--text-small", size: 14, weight: 400, lineHeight: 1.5 },
  { name: "Caption", variable: "--text-caption", size: 12, weight: 400, lineHeight: 1.5 },
] as const;

export const spacingTokens = [
  { name: "space-1", value: 4 },
  { name: "space-2", value: 8 },
  { name: "space-3", value: 12 },
  { name: "space-4", value: 16 },
  { name: "space-6", value: 24 },
  { name: "space-8", value: 32 },
  { name: "space-12", value: 48 },
  { name: "space-16", value: 64 },
  { name: "space-24", value: 96 },
] as const;
