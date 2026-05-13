export type AiProvider = "openai-compatible" | "anthropic";

export type AiConfig = {
  provider: AiProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
};

export type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export function getAiConfig(): AiConfig | null {
  const baseUrl = process.env.AI_API_BASE_URL ?? process.env.LLM_BASE_URL;
  const apiKey = process.env.AI_API_KEY ?? process.env.LLM_API_KEY;

  if (!baseUrl || !apiKey) {
    return null;
  }

  const rawProvider = (process.env.AI_PROVIDER ?? "openai-compatible").toLowerCase();
  const provider: AiProvider = rawProvider === "anthropic" ? "anthropic" : "openai-compatible";
  const model =
    process.env.AI_MODEL ??
    process.env.LLM_MODEL ??
    (provider === "anthropic" ? "claude-3-5-sonnet-latest" : "gpt-4o-mini");
  const timeoutMs = Number.parseInt(process.env.AI_TIMEOUT_MS ?? process.env.LLM_TIMEOUT_MS ?? "12000", 10);

  return {
    provider,
    baseUrl,
    apiKey,
    model,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 12000
  };
}

export async function requestAiText(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): Promise<string | null> {
  if (config.provider === "anthropic") {
    return requestAnthropicText(config, messages, signal);
  }

  return requestOpenAiCompatibleText(config, messages, signal);
}

export async function* requestAiTextStream(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  if (config.provider === "anthropic") {
    yield* requestAnthropicTextStream(config, messages, signal);
    return;
  }

  yield* requestOpenAiCompatibleTextStream(config, messages, signal);
}

export function createTimeoutSignal(timeoutMs: number): { signal: AbortSignal; clear: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  return {
    signal: controller.signal,
    clear: () => clearTimeout(timer)
  };
}

async function requestOpenAiCompatibleText(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): Promise<string | null> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages
    }),
    signal
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string;
      };
    }>;
  };

  return payload.choices?.[0]?.message?.content?.trim() ?? null;
}

async function* requestOpenAiCompatibleTextStream(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      temperature: 0.2,
      messages,
      stream: true
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`AI stream request failed with status ${response.status}`);
  }

  for await (const data of readSseData(response)) {
    if (data === "[DONE]") {
      return;
    }

    const payload = parseJson<{
      choices?: Array<{
        delta?: {
          content?: unknown;
        };
      }>;
    }>(data);
    const text = payload?.choices?.[0]?.delta?.content;

    if (typeof text === "string" && text.length > 0) {
      yield text;
    }
  }
}

async function requestAnthropicText(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): Promise<string | null> {
  const system = messages.find((message) => message.role === "system")?.content;
  const promptMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 800,
      temperature: 0.2,
      ...(system ? { system } : {}),
      messages: promptMessages
    }),
    signal
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as {
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  };

  const text = payload.content
    ?.map((part) => part.text)
    .filter((part): part is string => Boolean(part))
    .join("")
    .trim();

  return text || null;
}

async function* requestAnthropicTextStream(config: AiConfig, messages: AiMessage[], signal?: AbortSignal): AsyncGenerator<string> {
  const system = messages.find((message) => message.role === "system")?.content;
  const promptMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content
    }));

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": process.env.ANTHROPIC_VERSION ?? "2023-06-01"
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 800,
      temperature: 0.2,
      stream: true,
      ...(system ? { system } : {}),
      messages: promptMessages
    }),
    signal
  });

  if (!response.ok) {
    throw new Error(`AI stream request failed with status ${response.status}`);
  }

  for await (const data of readSseData(response)) {
    const payload = parseJson<{
      type?: string;
      delta?: {
        type?: string;
        text?: unknown;
      };
      content_block?: {
        type?: string;
        text?: unknown;
      };
    }>(data);

    if (payload?.type === "content_block_delta" && payload.delta?.type === "text_delta" && typeof payload.delta.text === "string") {
      yield payload.delta.text;
    }

    if (payload?.type === "content_block_start" && payload.content_block?.type === "text" && typeof payload.content_block.text === "string") {
      yield payload.content_block.text;
    }
  }
}

async function* readSseData(response: Response): AsyncGenerator<string> {
  if (!response.body) {
    throw new Error("AI stream response body is empty");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const data = parseSseDataLine(line);

        if (data !== null) {
          yield data;
        }
      }
    }

    buffer += decoder.decode();
    const data = parseSseDataLine(buffer);

    if (data !== null) {
      yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseDataLine(line: string): string | null {
  if (!line.startsWith("data:")) {
    return null;
  }

  return line.slice(5).trimStart();
}

function parseJson<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
