# Streaming API and SDK compatibility

Use the existing Chat Completions endpoint with `stream: true` or `false`.
Adapters translate native OpenAI/DeepSeek, Anthropic and Gemini SSE events into
text deltas. No whole-response buffering or provider routing logic lives in Route.

The public stream has one platform ID and model slug, `chat.completion.chunk`
objects, index 0 deltas, a final finish reason, optional empty-choices usage chunk
for `stream_options.include_usage`, then `data: [DONE]`. Before streaming starts,
errors retain normal HTTP statuses and the existing safe error envelope. After
output starts, errors use a safe SSE error envelope and close without a success
`[DONE]`. A partially delivered stream is never replayed or joined to another one.

Admission keeps the existing Session-independent platform-key checks, Redis limits,
database channel admission/circuit breaker and one Decimal wallet reservation.
Streaming holds concurrency capacity until transport completion or cancellation.
Adapters require authoritative final usage and the provider's terminal marker.
Only a complete validated stream settles one USAGE ledger entry. Interrupted,
cancelled or usage-missing requests release the hold and become FAILED. Known
provider usage is recorded even on failure; otherwise cost remains NULL and
PENDING_RECONCILIATION. Partial usage snapshots never authorize customer billing.
Financial finalization is idempotent and independent of Redis cleanup.
OpenAI requires its empty-choices final usage chunk. The DeepSeek adapter also
accepts authoritative usage attached to a valid terminal finish choice, matching
the verified live DeepSeek protocol; it still requires `[DONE]`. Neither adapter
can bill from usage on an unfinished content delta. Public output keeps the same
OpenAI-compatible final usage-only chunk regardless of this native difference.
Cancellation is checked after acquiring wallet locks and before committing the
charge. A disconnect after a terminal ledger has committed cannot rewrite that
completed transaction. Confirmed provider usage survives cancellation while
waiting for accounting locks or flushing the final redaction buffer.

Bounded SSE parsing accepts CRLF/LF, fragmented UTF-8, comments and multi-line data.
HTTP/body deadlines remain active for the whole stream. Cancellation propagates
to fetch/readers immediately. The response uses incremental backpressure, bounded
buffers and no-cache/no-transform/X-Accel-Buffering headers. Incremental secret
redaction handles values split across events without buffering ordinary text.

The development rollout still enables only DeepSeek. All four adapters and official
Python/JavaScript OpenAI SDKs plus curl are exercised against isolated databases,
Redis and local native-protocol fixtures. No US provider is enabled by testing.

## Running the examples and tests

The examples read `AIHUB_API_KEY`, `AIHUB_BASE_URL` (default
`http://127.0.0.1:3000/v1`) and `AIHUB_MODEL` (default `deepseek-flash`) from the
environment. Use a platform key, never the provider key. Run `node examples/chat.mjs`,
`python examples/chat.py`, or `powershell -File examples/chat-curl.ps1`.
Each example sends one normal and one streaming request. Keys and response contents
are never printed by automated tests; the interactive examples print the requested
model output and usage.

JavaScript tests use the locked official `openai` dev dependency (7.31.0).
Install Python's official SDK into the workspace, without modifying global Python:

```powershell
python -m pip install --target work/python-sdk -r scripts/requirements-sdk.txt
$env:PYTHON_TEST_PATH = (Resolve-Path work/python-sdk).Path
$env:PYTHON_TEST_EXECUTABLE = (python -c "import sys; print(sys.executable)")
npm run build
npm run test:streaming
```

The Python test pins OpenAI 3.26.1. `PYTHON_TEST_EXECUTABLE` can select a local Python
executable; the default uses `python` on Windows and `python3` elsewhere.
Set `PYTHON_TEST_PATH` to the directory containing the locally installed SDK.
The matching `curl.exe` (Windows) or `curl` command must be available. Tests require the isolated PostgreSQL
`aihub_auth_test` and local Redis DB 15 configuration; test ports 3150–3152 must be
free. Fixtures and their synthetic credentials are cleaned on exit.

Compatibility covers text-only Chat Completions, one choice, supported sampling
and token limits, `stream`, and `stream_options.include_usage`. Tools, multimodal
input and unrelated OpenAI endpoints remain outside this stage. Proxies must
disable SSE response buffering and keep their idle/request timeout above the
configured provider timeout (90 seconds by default, 120 seconds router ceiling).
The provider deadline terminates accounting even when downstream demand is paused.

Protocol references: [OpenAI streaming events](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events),
[OpenAI usage option](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create),
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
[Gemini generate/stream methods](https://ai.google.dev/api/generate-content),
[DeepSeek Chat Completions](https://api-docs.deepseek.com/api/create-chat-completion/).
