import "server-only";
import { GatewayError, type ChatCompletionInput } from "../types";

// Native APIs have a separate system field. Reject mid-conversation instructions
// rather than silently moving them and changing the meaning of the conversation.
export function nativeTextInput(input: ChatCompletionInput) {
  const system: string[] = [];
  const messages: { role: "user" | "assistant"; content: string }[] = [];
  for (const message of input.messages) {
    if (message.role === "system" || message.role === "developer") {
      if (messages.length) throw new GatewayError(400, "Place system and developer messages before the conversation for this model.", "invalid_request_error", "invalid_request");
      system.push(message.content);
    } else messages.push({ role: message.role, content: message.content });
  }
  if (!messages.length) throw new GatewayError(400, "Include at least one conversation message for this model.", "invalid_request_error", "invalid_request");
  return { system: system.join("\n\n"), messages };
}
export function stopSequences(input: ChatCompletionInput) {
  return input.stop === undefined ? undefined : typeof input.stop === "string" ? [input.stop] : input.stop;
}
