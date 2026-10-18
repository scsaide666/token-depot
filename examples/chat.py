import os
from openai import OpenAI

client = OpenAI(
    base_url=os.getenv("AIHUB_BASE_URL", "http://127.0.0.1:3000/v1"),
    api_key=os.environ["AIHUB_API_KEY"],
    max_retries=0,
)
model = os.getenv("AIHUB_MODEL", "deepseek-flash")
messages = [{"role": "user", "content": "Say hello briefly."}]
response = client.chat.completions.create(model=model, messages=messages, max_tokens=32)
print(response.choices[0].message.content)

with client.chat.completions.create(
    model=model, messages=messages, max_tokens=32,
    stream=True, stream_options={"include_usage": True},
) as stream:
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            print(chunk.choices[0].delta.content, end="", flush=True)
        if chunk.usage:
            print("\nUsage:", chunk.usage)
