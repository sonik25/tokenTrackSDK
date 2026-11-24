# tokenTrackSDK

TokenTrack is a lightweight TypeScript SDK for developers and organizations who want to track AI-provider usage from their Node.js applications.

TokenTrack supports OpenAI Chat Completions and Responses, Anthropic Messages,
and Gemini Generate Content on Node.js 22.12 or later. Install Core and the
provider packages you use once the packages are available on npm.

```sh
npm install @tokentrack/core @tokentrack/openai
npm install @tokentrack/anthropic @tokentrack/gemini
```

## Storage and operation grouping

Use one shared storage adapter and operation context for the tracker and manager.
The context groups provider requests by the active operation, including nested
operations. A manually tracked event can set `operationId` to override that
context. Consume streaming responses inside the operation callback to group
their usage with the operation.

```ts
import { MemoryStorage, OperationContext, OperationManager, UsageTracker } from '@tokentrack/core';

const storage = new MemoryStorage();
const context = new OperationContext();
const usageTracker = new UsageTracker(storage, context);
const operations = new OperationManager(storage, context);

await operations.run('Answer customer', async () => {
  await usageTracker.track({ provider: 'openai', model: 'mock', usage: { inputTokens: 3 } });
});
console.log(await operations.getSummaries());
```

Memory storage is process-local and lasts until the process exits. To persist
usage, use `new JsonFileStorage('./usage.json', { onCorruption })` as the shared
adapter. JSON storage reads and parses the entire history for each read and
rewrites it through a temporary file and atomic rename on each update. Cost
increases with history size. Use it for small local histories, and provide a
custom storage adapter for workloads that need indexed reads or frequent writes.
On one local Windows run, a 1.12 MB file with 3,000 operations and 3,000 usage
events took 8–12 ms to read and 17–21 ms to update. These are sample timings.

Use one owning process and one consistent path per JSON file on a local
filesystem. Instances using the same resolved path in one process queue
transactions together. An exclusive sidecar `.lock` rejects contention from
another process with `EEXIST`. Use the same path across callers and avoid
filesystem aliases, direct edits while the SDK is active, and network shares.
A crash can leave a sidecar behind. Remove it only after verifying that all
writers have stopped. Corruption recovery keeps the original in a `.bak` file
and salvages valid records when the JSON can be parsed.

Built-in adapters guard terminal transitions so one competing completion or
failure wins. Custom adapters must honor the optional expected status in
`saveOperation` for the same guarantee. `run()` preserves application results
and exceptions if operation storage fails. A persisted `running` record
means a terminal update has yet to be recorded. It can outlive the work.

## Usage and pricing

Adapters accept non-negative safe integers, including zero. Missing and invalid
counters remain unknown. Out-of-range sums are omitted. When a provider splits
a count into a main and supplemental category, TokenTrack includes valid
supplemental counts and omits the sum if a supplied component is invalid.
Optional supplemental fields may be omitted by the provider.

Cached tokens are part of inclusive input usage. Reasoning tokens are part of
inclusive output usage. `calculateEstimatedCost` applies configured model rates
to these subsets once and returns undefined when an input or output total
is unknown. Estimates depend on the supplied pricing version and token rates.
Provider-reported cost is stored separately when supplied and may include
charges outside token pricing. The wrappers collect usage and request metadata.
They do not persist API keys, prompts, or generated responses.

## OpenAI Chat Completions and Responses

```ts
import { OpenAIChatWrapper, OpenAIResponsesWrapper } from '@tokentrack/openai';

const chat = new OpenAIChatWrapper({ client, usageTracker });
const responses = new OpenAIResponsesWrapper({ client, usageTracker });
const options = { signal: controller.signal };
const reply = await chat.create(
  {
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'Say hello.' }],
  },
  options,
);
const stream = await responses.create(
  {
    model: 'gpt-4o',
    input: 'Say hello.',
    stream: true,
  },
  options,
);
for await (const event of stream) {
  if (event.type === 'response.output_text.delta') process.stdout.write(event.delta);
}
```

The wrappers forward SDK request options and return native promises. Use the SDK
directly when you need `APIPromise` helpers such as `asResponse()` or
`withResponse()`. Supported SDK versions are pinned in each provider package.
Provider exceptions propagate. Wrapper storage failures are best effort.

Chat enables `stream_options.include_usage`. It records the last usage chunk
with empty choices after clean exhaustion, at most once per stream consumption.
Early cancellation, transport failure, or missing final usage yields no Chat
usage event. Responses records the first terminal event with usable usage for
each response ID, including `incomplete` and `failed`. This records billable
usage even when a later transport error or cancellation follows the terminal
event. The optional usage `status` represents the provider's terminal outcome.
Legacy records and providers without a recorded outcome may omit it.

## Anthropic Messages

Pass an initialized Anthropic client and a Core usage tracker to the wrapper.

```ts
import { AnthropicMessagesWrapper } from '@tokentrack/anthropic';

const messages = new AnthropicMessagesWrapper({ client, usageTracker });
const params = {
  model: configuredClaudeModel,
  max_tokens: 100,
  messages: [{ role: 'user' as const, content: 'Say hello.' }],
};

const message = await messages.create(params);
const stream = await messages.create({ ...params, stream: true });
for await (const event of stream) {
  if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
    process.stdout.write(event.delta.text);
  }
}
```

Pass SDK request options, including an abort signal, as the second argument to `create`.
The wrapper returns a native promise and supports the raw SSE stream from
`messages.create({ stream: true })`. The higher-level SDK `messages.stream()` helper
and the SDK's `APIPromise` helpers `asResponse()` and `withResponse()` are outside
the wrapper API.

TokenTrack includes uncached, cache-read, and cache-write tokens in `inputTokens`
and exposes the cache counts separately. Streaming records usage after a
`message_stop` and clean stream exhaustion when at least one count is known.
It keeps the latest reported cumulative counts and takes final output usage from
`message_delta`. Without that count, output remains undefined. Consume the
stream to exhaustion to record usage, or use the shared controller to abort.
With `tee()`, each branch can finish independently and closing both branches
early closes the source. A faster branch buffers events for its slower open
peer with no fixed bound. Consume both branches concurrently or close an unused
branch. Prompts, system instructions, and generated content
are excluded from stored usage events.

Run the demos locally without credentials.

```sh
pnpm --filter @tokentrack/anthropic... build
pnpm exec tsx examples/anthropic-messages-demo.ts
pnpm exec tsx examples/anthropic-messages-streaming-demo.ts
```

## Gemini Generate Content

Pass an initialized `GoogleGenAI` client and a Core usage tracker to the wrapper.

```ts
import { GeminiModelsWrapper } from '@tokentrack/gemini';

const models = new GeminiModelsWrapper({ client, usageTracker });
const params = { model: 'gemini-2.5-flash', contents: 'Explain TypeScript generics.' };

const response = await models.generateContent(params);
const stream = await models.generateContentStream(params);
for await (const chunk of stream) {
  process.stdout.write(chunk.text ?? '');
}
```

TokenTrack uses Gemini's prompt plus tool-use prompt count for inclusive input
and candidate plus thinking count for inclusive output. The prompt count
already includes cached tokens. Cached and thinking counts remain available
as details. A missing prompt or candidate count leaves its inclusive count
unknown, even when a supplemental count is available. TokenTrack preserves the
reported total and derives one only when all four categories are reported.
Streaming takes the latest valid value of each field in cumulative metadata
and records it once after clean exhaustion. Cancellation and stream errors
skip Gemini tracking. [Gemini GenerateContent reference](https://aistudio.google.com/api-reference/generate-content)

Run the mocked demos without credentials.

```sh
pnpm --filter @tokentrack/gemini... build
pnpm exec tsx examples/gemini-generate-content-demo.ts
pnpm exec tsx examples/gemini-streaming-demo.ts
```

Build all packages and run the credential-free OpenAI demos.

```sh
pnpm --filter "./packages/*" build
pnpm exec tsx examples/openai-chat-demo.ts
pnpm exec tsx examples/openai-responses-demo.ts
pnpm exec tsx examples/openai-responses-streaming-demo.ts
```
