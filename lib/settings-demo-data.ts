export const demoProfile = { name: "Jamie Davis", email: "jamie@example.com", avatar: "" };

export const demoSessions = [
  { id: "current", browser: "Chrome on macOS", device: "Desktop", activity: "Active now", current: true },
  { id: "mobile", browser: "Safari on iPhone", device: "Mobile", activity: "Oct 4, 2026 at 09:18", current: false },
] as const;

export function profileInitials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] ?? "").join("").toUpperCase() || "JD";
}
