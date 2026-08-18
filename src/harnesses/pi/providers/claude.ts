/**
 * Claude Code CLI bridge provider for pi.
 *
 * This intentionally does NOT implement Claude OAuth or read Anthropic tokens.
 * Authentication stays entirely inside the official `claude` CLI (`claude login`
 * or its supported API-key/settings flow). pi shells out to Claude Code in
 * print mode and exposes a small, explicit model set.
 *
 * Provider id: `claude-cli`
 */

import { spawn } from "node:child_process";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
  TextContent,
} from "@earendil-works/pi-ai";
import { calculateCost, createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const MODEL_TO_CLAUDE = new Map([
  ["sonnet", "sonnet"],
  ["opus", "opus"],
]);

const THINKING_TO_EFFORT: Partial<Record<ThinkingLevel, string>> = {
  minimal: "low",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
};

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
        return (block as { text?: string }).text ?? "";
      }
      if (block && typeof block === "object" && (block as { type?: string }).type === "image") {
        return "[image omitted by claude-cli bridge]";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function promptFromContext(context: Context): string {
  const parts: string[] = [];
  for (const message of context.messages) {
    const text = textFromContent((message as { content?: unknown }).content).trim();
    if (!text) continue;
    parts.push(`${message.role.toUpperCase()}:\n${text}`);
  }
  return parts.join("\n\n");
}

function claudeArgs(model: Model<Api>, context: Context, options?: SimpleStreamOptions): string[] {
  const claudeModel = MODEL_TO_CLAUDE.get(model.id) ?? model.id;
  const args = [
    "--print",
    "--output-format",
    "text",
    "--model",
    claudeModel,
    "--permission-mode",
    "plan",
    "--no-session-persistence",
  ];

  if (context.systemPrompt?.trim()) {
    args.push("--append-system-prompt", context.systemPrompt.trim());
  }

  const level = options?.reasoning as ThinkingLevel | undefined;
  const effort = level ? THINKING_TO_EFFORT[level] : undefined;
  if (effort) args.push("--effort", effort);

  args.push(promptFromContext(context));
  return args;
}

function streamClaudeCli(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const output: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "pending",
    timestamp: Date.now(),
  };

  const child = spawn("claude", claudeArgs(model, context, options), {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let contentIndex: number | null = null;
  let stderr = "";

  stream.push({ type: "start", partial: output });

  const abort = () => child.kill("SIGTERM");
  options?.signal?.addEventListener("abort", abort, { once: true });

  child.stdout.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf8");
    if (!text) return;
    if (contentIndex === null) {
      const block: TextContent = { type: "text", text: "" };
      output.content.push(block);
      contentIndex = output.content.length - 1;
      stream.push({ type: "text_start", contentIndex, partial: output });
    }
    (output.content[contentIndex] as TextContent).text += text;
    stream.push({ type: "text_delta", contentIndex, delta: text, partial: output });
  });

  child.stderr.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  child.on("error", (error) => {
    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = error.message;
    stream.push({ type: "error", reason: output.stopReason, error: output });
    stream.end();
  });

  child.on("close", (code) => {
    options?.signal?.removeEventListener("abort", abort);
    if (code === 0) {
      output.stopReason = "end_turn";
      output.usage.output = Math.ceil(
        output.content
          .filter((block): block is TextContent => block.type === "text")
          .map((block) => block.text)
          .join("\n").length / 4,
      );
      output.usage.totalTokens = output.usage.output;
      calculateCost(model, output.usage);
      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
      return;
    }

    output.stopReason = options?.signal?.aborted ? "aborted" : "error";
    output.errorMessage = stderr.trim() || `claude exited with status ${code}`;
    stream.push({ type: "error", reason: output.stopReason, error: output });
    stream.end();
  });

  return stream;
}

export default function claudeCliBridge(pi: ExtensionAPI) {
  pi.registerProvider("claude-cli", {
    name: "Claude Code CLI",
    baseUrl: "local://claude-cli",
    api: "claude-cli-bridge",
    apiKey: "local-bridge",
    models: [
      {
        id: "sonnet",
        name: "Claude Sonnet (Claude Code CLI)",
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 64000,
      },
      {
        id: "opus",
        name: "Claude Opus (Claude Code CLI)",
        reasoning: true,
        thinkingLevelMap: { off: null, minimal: "low", low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "max" },
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 64000,
      },
    ],
    streamSimple: streamClaudeCli,
  });
}
