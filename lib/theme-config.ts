/* Preserve the existing key so the visual upgrade keeps saved preferences. */
export const THEME_STORAGE_KEY = "token-ui-theme";
export const THEME_COLORS = { light: "#f5f9ff", dark: "#0b1018" } as const;
export const themeOptions = [
  { value: "light", label: "Light", chineseLabel: "浅色模式", accessibleLabel: "Light mode" },
  { value: "dark", label: "Dark", chineseLabel: "深色模式", accessibleLabel: "Dark mode" },
  { value: "system", label: "System", chineseLabel: "跟随系统", accessibleLabel: "System theme" },
] as const;
