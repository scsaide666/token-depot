// Hard caps protect parsing and upstream budgets regardless of the selected model.
export const CHAT_LIMITS = {
  bodyBytes: 256 * 1024,
  messages: 64,
  messageCharacters: 32768,
  inputCharacters: 131072,
  outputTokens: 32768,
} as const;
