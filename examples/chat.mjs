import OpenAI from "openai";

const client = new OpenAI({
  baseURL: process.env.AIHUB_BASE_URL ?? "http://127.0.0.1:3000/v1",
  apiKey: process.env.AIHUB_API_KEY,
  maxRetries: 0,
});
const model = process.env.AIHUB_MODEL ?? "deepseek-flash";
const messages = [{ role: "user", content: "Say hello briefly." }];
const response = await client.chat.completions.create({ model, messages, max_tokens: 32 });
console.log(response.choices[0].message.content);

const stream = await client.chat.completions.create({ model, messages, max_tokens: 32, stream: true, stream_options: { include_usage: true } });
for await (const chunk of stream) {
  if (chunk.choices[0]?.delta.content) process.stdout.write(chunk.choices[0].delta.content);
  if (chunk.usage) console.log("\nUsage:", chunk.usage);
}
