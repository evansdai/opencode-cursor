import { createLogger } from "../utils/logger.js";

const log = createLogger("proxy:prompt-builder");

/**
 * Build a text prompt from OpenAI chat messages + tool definitions.
 * Handles role:"tool" result messages and assistant tool_calls that
 * plain text flattening would silently drop.
 */
export function buildPromptFromMessages(messages: Array<any>, tools: Array<any>, subagentNames: string[] = []): string {
  const messageSummary = messages.map((m: any, i: number) => {
    const role = m?.role ?? "?";
    const hasToolCalls = Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0;
    const tcNames = hasToolCalls > 0 ? m.tool_calls.map((tc: any) => tc?.function?.name).join(",") : "";
    const contentType = typeof m?.content;
    const contentLen = typeof m?.content === "string" ? m.content.length : Array.isArray(m?.content) ? `arr:${m.content.length}` : "null";
    const toolCallId = m?.tool_call_id ?? null;
    return { i, role, hasToolCalls, tcNames, contentType, contentLen, toolCallId };
  });

  const assistantWithToolCalls = messages.filter((m: any) => m?.role === "assistant" && Array.isArray(m?.tool_calls) && m.tool_calls.length > 0);
  const assistantEmpty = messages.filter((m: any) => m?.role === "assistant" && (!m?.tool_calls || m.tool_calls.length === 0) && (!m?.content || m.content === "" || m.content === null));
  const toolResults = messages.filter((m: any) => m?.role === "tool");

  log.debug("buildPromptFromMessages", {
    totalMessages: messages.length,
    totalTools: tools.length,
    messageSummary,
    stats: {
      assistantWithToolCalls: assistantWithToolCalls.length,
      assistantEmpty: assistantEmpty.length,
      toolResults: toolResults.length,
    },
    assistantDetails: assistantWithToolCalls.length > 0 ? assistantWithToolCalls.map((m: any, i: number) => ({
      index: i,
      toolCallCount: Array.isArray(m?.tool_calls) ? m.tool_calls.length : 0,
      toolCallIds: Array.isArray(m?.tool_calls) ? m.tool_calls.map((tc: any) => tc?.id).join(",") : "",
      toolCallNames: Array.isArray(m?.tool_calls) ? m.tool_calls.map((tc: any) => tc?.function?.name).join(",") : "",
      contentType: typeof m?.content,
      contentPreview: typeof m?.content === "string" ? m.content.slice(0, 50) : typeof m?.content,
    })) : [],
    emptyAssistantDetails: assistantEmpty.length > 0 ? assistantEmpty.map((m: any, i: number) => ({
      index: i,
      contentType: typeof m?.content,
      contentPreview: typeof m?.content === "string" ? m.content.slice(0, 50) : typeof m?.content,
    })) : [],
    toolResultDetails: toolResults.length > 0 ? toolResults.map((m: any, i: number) => ({
      index: i,
      toolCallId: m?.tool_call_id,
      contentPreview: typeof m?.content === "string" ? m.content.slice(0, 100) : typeof m?.content,
    })) : [],
  });

  const lines: string[] = [];

  if (tools.length > 0) {
    const toolDescs = tools
      .map((t: any) => {
        const fn = t.function || t;
        const name = fn.name || "unknown";
        const desc = fn.description || "";
        const params = fn.parameters;
        const paramStr = params ? JSON.stringify(params) : "{}";
        return `- ${name}: ${desc}\n  Parameters: ${paramStr}`;
      })
      .join("\n");
    const mcpToolNames = tools
      .map((t: any) => t?.function?.name ?? t?.name)
      .filter((name: any): name is string => typeof name === "string" && isKnownDirectMcpTool(name));
    const mcpGuidance = mcpToolNames.length > 0
      ? `
- MCP: call exact OpenCode MCP tool names directly (${mcpToolNames.join(", ")}). Never use webSearch or shell-based MCP commands in OpenCode mode.`
      : "";
    lines.push(
      `SYSTEM: You have access to the following tools. When you need to use one, respond with a tool_call in the standard OpenAI format.
` +
        `Tool guidance: use write for new/full-file writes, edit only for exact text replacement, task for delegation; use bash mainly to run commands/tests.
` +
        `Required arguments (OpenCode schema — use exact keys):
` +
        `- glob: pattern (required), optional path.
` +
        `- grep: pattern and path. Do not use glob for text search.
` +
        `- write: path and content for new files and full-file writes.
` +
        `- edit: path, old_string, new_string. Never call edit with old_string=""; use write instead.
` +
        `- task: description, prompt, subagent_type.${mcpGuidance}

Available tools:
${toolDescs}`,
    );
    const taskSubagentNames = extractTaskSubagentNames(tools, subagentNames);
    if (taskSubagentNames.length > 0) {
      lines.push(
        `When calling the task tool, subagent_type is REQUIRED. Use one of: ${taskSubagentNames.join(", ")}. Never use category or subagentType.`
      );
    }
  }

  for (const message of messages) {
    const role = typeof message.role === "string" ? message.role : "user";

    // tool result messages (from multi-turn tool execution loop)
    if (role === "tool") {
      const callId = message.tool_call_id || "unknown";
      const body =
        typeof message.content === "string"
          ? message.content
          : JSON.stringify(message.content ?? "");
      lines.push(`TOOL_RESULT (call_id: ${callId}): ${body}`);
      continue;
    }

    // assistant messages that contain tool_calls (previous turn's tool invocations)
    if (
      role === "assistant" &&
      Array.isArray(message.tool_calls) &&
      message.tool_calls.length > 0
    ) {
      const tcTexts = message.tool_calls.map((tc: any) => {
        const fn = tc.function || {};
        return `tool_call(id: ${tc.id || "?"}, name: ${fn.name || "?"}, args: ${fn.arguments || "{}"})`;
      });
      const text = typeof message.content === "string" ? message.content : "";
      lines.push(`ASSISTANT: ${text ? text + "\n" : ""}${tcTexts.join("\n")}`);
      continue;
    }

    // standard text messages
    const content = message.content;
    if (typeof content === "string") {
      lines.push(`${role.toUpperCase()}: ${content}`);
    } else if (Array.isArray(content)) {
      const textParts = content
        .map((part: any) => {
          if (part && typeof part === "object" && part.type === "text" && typeof part.text === "string") {
            return part.text;
          }
          return "";
        })
        .filter(Boolean);
      if (textParts.length) {
        lines.push(`${role.toUpperCase()}: ${textParts.join("\n")}`);
      }
    }
  }

  // Add continuation suffix after tool results to anchor model on completed state
  const hasToolResults = messages.some((m: any) => m?.role === "tool");
  if (hasToolResults) {
    lines.push(
      "The above tool calls have been executed. Continue your response based on these results."
    );
  }

  const finalPrompt = lines.join("\n\n");
  log.debug("buildPromptFromMessages: final prompt", {
    lineCount: lines.length,
    promptLength: finalPrompt.length,
    promptPreview: finalPrompt.slice(0, 500),
    hasToolResultFormat: finalPrompt.includes("TOOL_RESULT"),
    hasAssistantToolCallFormat: finalPrompt.includes("tool_call(id:"),
    hasCompletionSignal: finalPrompt.includes("The above tool calls have been executed"),
  });

  return finalPrompt;
}


function isKnownDirectMcpTool(name: string): boolean {
  return name === "context7_resolve-library-id"
    || name === "context7_query-docs"
    || name === "grep_app_searchGitHub"
    || name === "websearch_web_search_exa"
    || name.startsWith("mcp__");
}

function extractTaskSubagentNames(tools: Array<any>, fallbackNames: string[]): string[] {
  for (const tool of tools) {
    const fn = tool?.function ?? tool;
    if ((fn?.name ?? "").toLowerCase() !== "task") {
      continue;
    }
    const parameters = fn?.parameters;
    const subagentSchema = parameters?.properties?.subagent_type;
    const enumValues = Array.isArray(subagentSchema?.enum)
      ? subagentSchema.enum.filter((value: unknown): value is string => typeof value === "string" && value.length > 0)
      : [];
    if (enumValues.length > 0) {
      return enumValues;
    }
  }
  return fallbackNames;
}
