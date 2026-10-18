import type { PlaygroundMessage } from "./playground-types";

export function completedContext(messages: PlaygroundMessage[]) {
  const result: { role: "user" | "assistant"; content: string }[] = [];
  for (let index = 0; index < messages.length - 1; index++) {
    const user = messages[index], assistant = messages[index + 1];
    if (user.role === "user" && assistant.role === "assistant" && assistant.state === "complete") {
      result.push({ role: "user", content: user.content }, { role: "assistant", content: assistant.content }); index++;
    }
  }
  return result;
}
