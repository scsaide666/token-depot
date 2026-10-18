"use client";

import { useState } from "react";
import { Terminal } from "lucide-react";
import { CodeCopyButton } from "./code-copy-button";
import { HighlightedCode } from "./highlighted-code";

const languages = ["curl", "JavaScript", "Python"] as const;
type Language = typeof languages[number];

export function homeApiExamples(apiBaseUrl: string, model = "YOUR_MODEL_ID"): Record<Language, string> {
  const base = JSON.stringify(apiBaseUrl);
  const modelId = JSON.stringify(model);
  const body = ["{", `  "model": ${modelId},`, '  "messages": [{"role": "user", "content": "Hello, Token Depot."}],', '  "stream": true', "}"].join("\n");
  // POSIX-safe single-quoted JSON, including administrator-supplied model slugs.
  const shellBody = body.replace(/'/g, "'\\''");
  return {
    curl: `curl ${apiBaseUrl}/chat/completions \\\n  -H "Authorization: Bearer $AIHUB_API_KEY" \\\n  -H "Content-Type: application/json" \\\n  -d '${shellBody}'`,
    JavaScript: `import OpenAI from "openai";\n\nconst client = new OpenAI({\n  apiKey: process.env.AIHUB_API_KEY,\n  maxRetries: 0,\n  timeout: 180_000,\n  baseURL: ${base}\n});\n\nconst stream = await client.chat.completions.create({\n  model: ${modelId},\n  messages: [{ role: "user", content: "Hello, Token Depot." }],\n  stream: true\n});\n\nfor await (const chunk of stream) {\n  process.stdout.write(chunk.choices[0]?.delta.content ?? "");\n}`,
    Python: `import os\nfrom openai import OpenAI\n\nclient = OpenAI(\n    api_key=os.environ["AIHUB_API_KEY"],\n    max_retries=0,\n    timeout=180.0,\n    base_url=${base}\n)\n\nstream = client.chat.completions.create(\n    model=${modelId},\n    messages=[{"role": "user", "content": "Hello, Token Depot."}],\n    stream=True\n)\n\nfor chunk in stream:\n    if chunk.choices:\n        print(chunk.choices[0].delta.content or "", end="")`,
  };
}

export function ApiPreview({ apiBaseUrl, model }: { apiBaseUrl: string; model?: string }) {
  const [language, setLanguage] = useState<Language>("curl");
  const examples = homeApiExamples(apiBaseUrl, model);
  return (
    <figure className="v-terminal v-enter" aria-label="Token Depot API request example">
      <figcaption className="v-window-bar">
        <span className="v-terminal-label"><Terminal size={14} aria-hidden="true" /> API request</span>
        <CodeCopyButton code={examples[language]} label={`Copy ${language} example`} showLabel dark />
      </figcaption>
      <div className="v-code-tabs" role="group" aria-label="Example language">
        {languages.map(item => <button key={item} type="button" aria-pressed={item === language} onClick={() => setLanguage(item)}>{item}</button>)}
      </div>
      <pre className="v-code" tabIndex={0} aria-label={`${language} example. Scroll horizontally to read the full code.`}><HighlightedCode code={examples[language]} /></pre>
      {!model && <p className="v-terminal-empty">Choose an enabled model from the model catalog before making a request.</p>}
      <div className="v-terminal-footer"><code><span>POST</span> /v1/chat/completions</code><span>SSE streaming</span></div>
    </figure>
  );
}

