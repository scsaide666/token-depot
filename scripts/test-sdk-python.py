import json
import sys
from openai import OpenAI, APIStatusError, APIError

configuration = json.load(sys.stdin)
client = OpenAI(base_url=configuration["baseURL"], api_key=configuration["apiKey"], max_retries=0, timeout=20)
try:
    for model in configuration["models"]:
        request = dict(model=model, messages=[dict(role="user", content="SDK fixture")], max_tokens=16)
        response = client.chat.completions.create(**request)
        assert response.model == model and response.choices[0].message.content == "Hello 流式 👋"
        assert response.usage.total_tokens == 19
        text = ""
        usage = None
        with client.chat.completions.create(**request, stream=True, stream_options={"include_usage": True}) as stream:
            for chunk in stream:
                assert chunk.model == model
                if chunk.choices:
                    text += chunk.choices[0].delta.content or ""
                if chunk.usage:
                    usage = chunk.usage
        assert text == "Hello 流式 👋" and usage.total_tokens == 19
    bad = OpenAI(base_url=configuration["baseURL"], api_key="invalid-fixture-key", max_retries=0)
    try:
        bad.chat.completions.create(model=configuration["models"][0], messages=[dict(role="user", content="Hello")], stream=True)
        raise AssertionError("Expected authentication failure")
    except APIStatusError as error:
        assert error.status_code == 401
    if configuration.get("errorModel"):
        try:
            with client.chat.completions.create(model=configuration["errorModel"], messages=[dict(role="user", content="SDK fixture")], max_tokens=16, stream=True) as stream:
                for chunk in stream:
                    pass
            raise AssertionError("Expected streaming failure")
        except APIError as error:
            assert error.code == "streaming_interrupted"
    print(json.dumps({"sdk": "python", "models": len(configuration["models"]), "normal": True, "stream": True, "authentication": True, "streamingError": bool(configuration.get("errorModel"))}))
except Exception:
    # SDK exceptions can include request headers and upstream bodies; never print them.
    print("Python SDK compatibility check failed.", file=sys.stderr)
    sys.exit(1)
