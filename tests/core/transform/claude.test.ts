import { describe, expect, it } from "bun:test";
import {
	appendClaudeThinkingHint,
	applyClaudeTransforms,
	buildClaudeThinkingConfig,
	CLAUDE_INTERLEAVED_THINKING_HINT,
	CLAUDE_THINKING_MAX_OUTPUT_TOKENS,
	computeClaudeMaxOutputTokens,
	configureClaudeToolConfig,
	ensureClaudeMaxOutputTokens,
	isClaudeModel,
	isClaudeThinkingModel,
	normalizeClaudeTools,
} from "../../../src/core/transform/claude.ts";
import type { RequestPayload } from "../../../src/core/transform/types.ts";

type JsonObject = Record<string, unknown>;

function defined<T>(value: T | undefined | null, what: string): T {
	if (value == null) throw new Error(`missing ${what}`);
	return value;
}

function isJsonObject(value: unknown): value is JsonObject {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): JsonObject {
	if (!isJsonObject(value)) throw new Error(`invalid ${what}: expected an object`);
	return value;
}

function optionalRecord(value: unknown, what: string): JsonObject | undefined {
	return value == null ? undefined : record(value, what);
}

function array(value: unknown, what: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`invalid ${what}: expected an array`);
	return value;
}

function item<T>(values: readonly T[], index: number, what: string): T {
	return defined(values[index], what);
}

function records(value: unknown, what: string): JsonObject[] {
	return array(value, what).map((entry, index) => record(entry, `${what}[${index}]`));
}

function systemParts(payload: RequestPayload): JsonObject[] {
	const systemInstruction = record(payload["systemInstruction"], "system instruction");
	return records(systemInstruction["parts"], "system instruction parts");
}

function normalizedTools(payload: RequestPayload): JsonObject[] {
	return records(payload["tools"], "normalized tools");
}

function functionDeclarations(tool: JsonObject): JsonObject[] {
	return records(tool["functionDeclarations"], "function declarations");
}

function firstFunctionDeclaration(payload: RequestPayload): JsonObject {
	const tools = normalizedTools(payload);
	const declarations = functionDeclarations(item(tools, 0, "tools[0]"));
	return item(declarations, 0, "functionDeclarations[0]");
}

function functionParameters(payload: RequestPayload): JsonObject {
	return record(firstFunctionDeclaration(payload)["parameters"], "tool parameters");
}

describe("isClaudeModel", () => {
	it("returns true for claude model names", () => {
		expect(isClaudeModel("claude-sonnet-4-5")).toBe(true);
		expect(isClaudeModel("claude-opus-4-5")).toBe(true);
		expect(isClaudeModel("claude-3-opus")).toBe(true);
		expect(isClaudeModel("claude-3-5-sonnet")).toBe(true);
	});

	it("returns true for case-insensitive matches", () => {
		expect(isClaudeModel("CLAUDE-SONNET-4-5")).toBe(true);
		expect(isClaudeModel("Claude-Opus-4-5")).toBe(true);
		expect(isClaudeModel("cLaUdE-3-opus")).toBe(true);
	});

	it("returns true for prefixed claude models", () => {
		expect(isClaudeModel("antigravity-claude-sonnet-4-5")).toBe(true);
		expect(isClaudeModel("google/claude-opus-4-5")).toBe(true);
	});

	it("returns false for non-claude models", () => {
		expect(isClaudeModel("gemini-3-pro")).toBe(false);
		expect(isClaudeModel("gpt-4")).toBe(false);
		expect(isClaudeModel("llama-3")).toBe(false);
		expect(isClaudeModel("")).toBe(false);
	});

	it("returns false for similar but non-claude names", () => {
		expect(isClaudeModel("claudia-model")).toBe(false);
		expect(isClaudeModel("clade-model")).toBe(false);
	});
});

describe("isClaudeThinkingModel", () => {
	it("returns true for claude thinking models", () => {
		expect(isClaudeThinkingModel("claude-sonnet-4-5-thinking")).toBe(true);
		expect(isClaudeThinkingModel("claude-opus-4-5-thinking")).toBe(true);
		expect(isClaudeThinkingModel("claude-sonnet-4-5-thinking-high")).toBe(true);
		expect(isClaudeThinkingModel("claude-opus-4-5-thinking-low")).toBe(true);
		expect(isClaudeThinkingModel("claude-sonnet-4-6")).toBe(true);
	});

	it("returns true for case-insensitive matches", () => {
		expect(isClaudeThinkingModel("CLAUDE-SONNET-4-5-THINKING")).toBe(true);
		expect(isClaudeThinkingModel("Claude-Opus-4-5-Thinking")).toBe(true);
	});

	it("returns true for prefixed thinking models", () => {
		expect(isClaudeThinkingModel("antigravity-claude-sonnet-4-5-thinking")).toBe(true);
		expect(isClaudeThinkingModel("google/claude-opus-4-5-thinking-high")).toBe(true);
	});

	it("returns false for non-thinking claude models", () => {
		expect(isClaudeThinkingModel("claude-sonnet-4-5")).toBe(false);
		expect(isClaudeThinkingModel("claude-opus-4-5")).toBe(false);
		expect(isClaudeThinkingModel("claude-3-opus")).toBe(false);
	});

	it("returns false for non-claude models", () => {
		expect(isClaudeThinkingModel("gemini-3-pro-thinking")).toBe(false);
		expect(isClaudeThinkingModel("gpt-4-thinking")).toBe(false);
	});

	it("requires both claude and thinking keywords", () => {
		expect(isClaudeThinkingModel("thinking-model")).toBe(false);
		expect(isClaudeThinkingModel("claude-model")).toBe(false);
	});
});

describe("configureClaudeToolConfig", () => {
	it("creates toolConfig if not present", () => {
		const payload: RequestPayload = {};
		configureClaudeToolConfig(payload);

		expect(payload["toolConfig"]).toBeDefined();
		const toolConfig = record(payload["toolConfig"], "tool config");
		expect(toolConfig["functionCallingConfig"]).toBeDefined();
		const functionCallingConfig = record(
			toolConfig["functionCallingConfig"],
			"function calling config",
		);
		expect(functionCallingConfig["mode"]).toBe("VALIDATED");
	});

	it("adds functionCallingConfig to existing toolConfig", () => {
		const payload: RequestPayload = {
			toolConfig: { someOtherConfig: true },
		};
		configureClaudeToolConfig(payload);

		const toolConfig = record(payload["toolConfig"], "tool config");
		expect(toolConfig["someOtherConfig"]).toBe(true);
		expect(record(toolConfig["functionCallingConfig"], "function calling config")["mode"]).toBe(
			"VALIDATED",
		);
	});

	it("sets mode to VALIDATED on existing functionCallingConfig", () => {
		const payload: RequestPayload = {
			toolConfig: {
				functionCallingConfig: { existingKey: "value" },
			},
		};
		configureClaudeToolConfig(payload);

		const toolConfig = record(payload["toolConfig"], "tool config");
		const functionCallingConfig = record(
			toolConfig["functionCallingConfig"],
			"function calling config",
		);
		expect(functionCallingConfig["existingKey"]).toBe("value");
		expect(functionCallingConfig["mode"]).toBe("VALIDATED");
	});

	it("overwrites existing mode", () => {
		const payload: RequestPayload = {
			toolConfig: {
				functionCallingConfig: { mode: "AUTO" },
			},
		};
		configureClaudeToolConfig(payload);

		const toolConfig = record(payload["toolConfig"], "tool config");
		expect(record(toolConfig["functionCallingConfig"], "function calling config")["mode"]).toBe(
			"VALIDATED",
		);
	});

	it("handles null toolConfig gracefully", () => {
		const payload: RequestPayload = { toolConfig: null };
		configureClaudeToolConfig(payload);

		expect(payload["toolConfig"]).toBeDefined();
	});
});

describe("buildClaudeThinkingConfig", () => {
	it("builds config with include_thoughts only", () => {
		const config = buildClaudeThinkingConfig(true);

		expect(config).toEqual({ include_thoughts: true });
	});

	it("builds config with include_thoughts false", () => {
		const config = buildClaudeThinkingConfig(false);

		expect(config).toEqual({ include_thoughts: false });
	});

	it("includes thinking_budget when provided and positive", () => {
		const config = buildClaudeThinkingConfig(true, 8192);

		expect(config).toEqual({
			include_thoughts: true,
			thinking_budget: 8192,
		});
	});

	it("excludes thinking_budget when zero", () => {
		const config = buildClaudeThinkingConfig(true, 0);

		expect(config).toEqual({ include_thoughts: true });
	});

	it("excludes thinking_budget when negative", () => {
		const config = buildClaudeThinkingConfig(true, -100);

		expect(config).toEqual({ include_thoughts: true });
	});

	it("excludes thinking_budget when undefined", () => {
		const config = buildClaudeThinkingConfig(true, undefined);

		expect(config).toEqual({ include_thoughts: true });
	});

	it("handles various budget values", () => {
		expect(buildClaudeThinkingConfig(true, 8192)).toHaveProperty("thinking_budget", 8192);
		expect(buildClaudeThinkingConfig(true, 16384)).toHaveProperty("thinking_budget", 16384);
		expect(buildClaudeThinkingConfig(true, 32768)).toHaveProperty("thinking_budget", 32768);
	});
});

describe("ensureClaudeMaxOutputTokens", () => {
	it("sets maxOutputTokens when not present", () => {
		const config: Record<string, unknown> = {};
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
	});
	it("sets maxOutputTokens when current is less than budget", () => {
		const config: Record<string, unknown> = { maxOutputTokens: 4096 };
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
	});
	it("sets maxOutputTokens when current equals budget", () => {
		const config: Record<string, unknown> = { maxOutputTokens: 8192 };
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
	});
	it("does not change maxOutputTokens when current is greater than budget", () => {
		const config: Record<string, unknown> = { maxOutputTokens: 100000 };
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(100000);
	});

	it("handles snake_case max_output_tokens", () => {
		const config: Record<string, unknown> = { max_output_tokens: 4096 };
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
		expect(config["max_output_tokens"]).toBeUndefined();
	});
	it("removes max_output_tokens when setting maxOutputTokens", () => {
		const config: Record<string, unknown> = {
			max_output_tokens: 4096,
			maxOutputTokens: 4096,
		};
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
		expect(config["max_output_tokens"]).toBeUndefined();
	});
	it("prefers maxOutputTokens over max_output_tokens for comparison", () => {
		const config: Record<string, unknown> = {
			maxOutputTokens: 100000,
			max_output_tokens: 4096,
		};
		ensureClaudeMaxOutputTokens(config, 8192);

		expect(config["maxOutputTokens"]).toBe(100000);
	});
});

describe("appendClaudeThinkingHint", () => {
	describe("with string systemInstruction", () => {
		it("preserves existing string instruction and appends hint as separate part", () => {
			const payload: RequestPayload = {
				systemInstruction: "You are a helpful assistant.",
			};
			appendClaudeThinkingHint(payload);

			expect(payload["systemInstruction"]).toEqual({
				role: "user",
				parts: [
					{ text: "You are a helpful assistant." },
					{ text: CLAUDE_INTERLEAVED_THINKING_HINT },
				],
			});
		});

		it("uses hint alone when existing instruction is empty", () => {
			const payload: RequestPayload = {
				systemInstruction: "",
			};
			appendClaudeThinkingHint(payload);

			expect(payload["systemInstruction"]).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
		});

		it("uses hint alone when existing instruction is whitespace", () => {
			const payload: RequestPayload = {
				systemInstruction: "   ",
			};
			appendClaudeThinkingHint(payload);

			expect(payload["systemInstruction"]).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
		});

		it("accepts custom hint", () => {
			const payload: RequestPayload = {
				systemInstruction: "Base instruction.",
			};
			appendClaudeThinkingHint(payload, "Custom hint.");

			expect(payload["systemInstruction"]).toEqual({
				role: "user",
				parts: [{ text: "Base instruction." }, { text: "Custom hint." }],
			});
		});
	});

	describe("with object systemInstruction (parts array)", () => {
		it("preserves existing text parts and appends hint as separate part", () => {
			const payload: RequestPayload = {
				systemInstruction: {
					parts: [{ text: "First part." }, { text: "Last part." }],
				},
			};
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			expect(item(parts, 0, "system parts[0]")["text"]).toBe("First part.");
			expect(item(parts, 1, "system parts[1]")["text"]).toBe("Last part.");
			expect(item(parts, 2, "system parts[2]")["text"]).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
		});

		it("preserves single text part and appends hint as separate part", () => {
			const payload: RequestPayload = {
				systemInstruction: {
					parts: [{ text: "Only part." }],
				},
			};
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			expect(item(parts, 0, "system parts[0]")["text"]).toBe("Only part.");
			expect(item(parts, 1, "system parts[1]")["text"]).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
		});

		it("creates new text part when no text parts exist", () => {
			const payload: RequestPayload = {
				systemInstruction: {
					parts: [{ image: "base64data" }],
				},
			};
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			expect(parts).toHaveLength(2);
			expect(item(parts, 1, "system parts[1]")["text"]).toBe(CLAUDE_INTERLEAVED_THINKING_HINT);
		});

		it("creates parts array when not present", () => {
			const payload: RequestPayload = {
				systemInstruction: { role: "system" },
			};
			appendClaudeThinkingHint(payload);

			const systemInstruction = record(payload["systemInstruction"], "system instruction");
			expect(systemInstruction["parts"]).toEqual([{ text: CLAUDE_INTERLEAVED_THINKING_HINT }]);
		});
	});

	describe("with no systemInstruction", () => {
		it("creates systemInstruction when contents array exists", () => {
			const payload: RequestPayload = {
				contents: [{ role: "user", parts: [{ text: "Hello" }] }],
			};
			appendClaudeThinkingHint(payload);

			expect(payload["systemInstruction"]).toEqual({
				parts: [{ text: CLAUDE_INTERLEAVED_THINKING_HINT }],
			});
		});

		it("does not create systemInstruction when no contents", () => {
			const payload: RequestPayload = {};
			appendClaudeThinkingHint(payload);

			expect(payload["systemInstruction"]).toBeUndefined();
		});
	});

	describe("idempotency", () => {
		it("does not duplicate hint when called twice on object systemInstruction", () => {
			const payload: RequestPayload = {
				systemInstruction: {
					parts: [{ text: "You are a helpful assistant." }],
				},
			};
			appendClaudeThinkingHint(payload);
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			const hintParts = parts.filter((part) => part["text"] === CLAUDE_INTERLEAVED_THINKING_HINT);
			expect(hintParts).toHaveLength(1);
			expect(parts).toHaveLength(2);
		});

		it("does not duplicate hint when called twice on string systemInstruction", () => {
			const payload: RequestPayload = {
				systemInstruction: "Base instruction.",
			};
			appendClaudeThinkingHint(payload);
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			const hintParts = parts.filter((part) => part["text"] === CLAUDE_INTERLEAVED_THINKING_HINT);
			expect(hintParts).toHaveLength(1);
		});

		it("does not duplicate hint when called twice with no initial systemInstruction", () => {
			const payload: RequestPayload = {
				contents: [{ role: "user", parts: [{ text: "Hello" }] }],
			};
			appendClaudeThinkingHint(payload);
			appendClaudeThinkingHint(payload);

			const parts = systemParts(payload);
			const hintParts = parts.filter((part) => part["text"] === CLAUDE_INTERLEAVED_THINKING_HINT);
			expect(hintParts).toHaveLength(1);
		});
	});
});

describe("normalizeClaudeTools", () => {
	const identityClean = (schema: unknown) => record(schema, "JSON schema");

	const realClean = (schema: unknown): Record<string, unknown> => {
		if (!schema || typeof schema !== "object") return {};
		const cleaned = { ...record(schema, "JSON schema") };
		delete cleaned["$schema"];
		delete cleaned["$id"];
		return cleaned;
	};

	it("returns empty result when no tools", () => {
		const payload: RequestPayload = {};
		const result = normalizeClaudeTools(payload, identityClean);

		expect(result.toolDebugMissing).toBe(0);
		expect(result.toolDebugSummaries).toEqual([]);
	});

	it("returns empty result when tools is not an array", () => {
		const payload: RequestPayload = { tools: "not an array" };
		const result = normalizeClaudeTools(payload, identityClean);

		expect(result.toolDebugMissing).toBe(0);
		expect(result.toolDebugSummaries).toEqual([]);
	});

	describe("functionDeclarations format", () => {
		it("normalizes tools with functionDeclarations array", () => {
			const payload: RequestPayload = {
				tools: [
					{
						functionDeclarations: [
							{
								name: "get_weather",
								description: "Get weather for a location",
								parameters: {
									type: "object",
									properties: {
										location: { type: "string" },
									},
									required: ["location"],
								},
							},
						],
					},
				],
			};

			const result = normalizeClaudeTools(payload, identityClean);

			expect(result.toolDebugMissing).toBe(0);
			expect(result.toolDebugSummaries).toContain(
				"decl=get_weather,src=functionDeclarations,hasSchema=y",
			);

			const tools = normalizedTools(payload);
			expect(tools).toHaveLength(1);
			const declarations = functionDeclarations(item(tools, 0, "tools[0]"));
			expect(declarations).toHaveLength(1);
			expect(item(declarations, 0, "functionDeclarations[0]")["name"]).toBe("get_weather");
		});

		it("handles multiple functionDeclarations", () => {
			const payload: RequestPayload = {
				tools: [
					{
						functionDeclarations: [
							{ name: "tool1", description: "First tool" },
							{ name: "tool2", description: "Second tool" },
						],
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			const tools = normalizedTools(payload);
			const declarations = functionDeclarations(item(tools, 0, "tools[0]"));
			expect(declarations).toHaveLength(2);
		});
	});

	describe("function/custom format", () => {
		it("normalizes OpenAI-style function tools", () => {
			const payload: RequestPayload = {
				tools: [
					{
						type: "function",
						function: {
							name: "search",
							description: "Search the web",
							parameters: {
								type: "object",
								properties: {
									query: { type: "string" },
								},
							},
						},
					},
				],
			};

			const result = normalizeClaudeTools(payload, identityClean);

			expect(result.toolDebugSummaries).toContain("decl=search,src=function/custom,hasSchema=y");

			expect(firstFunctionDeclaration(payload)["name"]).toBe("search");
		});

		it("normalizes custom-style tools", () => {
			const payload: RequestPayload = {
				tools: [
					{
						custom: {
							name: "custom_tool",
							description: "A custom tool",
							input_schema: {
								type: "object",
								properties: { arg: { type: "string" } },
							},
						},
					},
				],
			};

			const result = normalizeClaudeTools(payload, identityClean);

			expect(result.toolDebugSummaries).toContain(
				"decl=custom_tool,src=function/custom,hasSchema=y",
			);
		});

		it("normalizes tools with top-level name/parameters", () => {
			const payload: RequestPayload = {
				tools: [
					{
						name: "direct_tool",
						description: "Direct definition",
						parameters: {
							type: "object",
							properties: { value: { type: "number" } },
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			expect(firstFunctionDeclaration(payload)["name"]).toBe("direct_tool");
		});
	});

	describe("schema normalization", () => {
		it("adds placeholder when schema is missing", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: "no_schema_tool",
							description: "Tool without schema",
						},
					},
				],
			};

			const result = normalizeClaudeTools(payload, identityClean);

			expect(result.toolDebugMissing).toBe(1);

			const params = functionParameters(payload);
			expect(params["type"]).toBe("object");
			expect(record(params["properties"], "parameter properties")["_placeholder"]).toBeDefined();
			expect(array(params["required"], "required parameters")).toContain("_placeholder");
		});

		it("adds placeholder when schema has no properties", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: "empty_schema_tool",
							parameters: { type: "object" },
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			const params = functionParameters(payload);
			expect(record(params["properties"], "parameter properties")["_placeholder"]).toBeDefined();
		});

		it("preserves existing properties", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: "has_props_tool",
							parameters: {
								type: "object",
								properties: {
									existingProp: { type: "string" },
								},
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			const params = functionParameters(payload);
			const properties = record(params["properties"], "parameter properties");
			expect(properties["existingProp"]).toBeDefined();
			expect(properties["_placeholder"]).toBeUndefined();
		});

		it("cleans schema using provided function", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: "needs_cleaning",
							parameters: {
								$schema: "http://json-schema.org/draft-07/schema#",
								type: "object",
								properties: { arg: { type: "string" } },
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, realClean);

			const params = functionParameters(payload);
			expect(params["$schema"]).toBeUndefined();
			expect(record(params["properties"], "parameter properties")["arg"]).toBeDefined();
		});
	});

	describe("tool name sanitization", () => {
		it("removes special characters from tool names", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: "tool@with#special$chars!",
							parameters: {
								type: "object",
								properties: { x: { type: "string" } },
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			expect(firstFunctionDeclaration(payload)["name"]).toBe("tool_with_special_chars_");
		});

		it("truncates long tool names to 64 characters", () => {
			const longName = "a".repeat(100);
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							name: longName,
							parameters: {
								type: "object",
								properties: { x: { type: "string" } },
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			expect(firstFunctionDeclaration(payload)["name"]).toHaveLength(64);
		});

		it("generates name when missing", () => {
			const payload: RequestPayload = {
				tools: [
					{
						function: {
							description: "Nameless tool",
							parameters: {
								type: "object",
								properties: { x: { type: "string" } },
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			expect(firstFunctionDeclaration(payload)["name"]).toBe("tool-0");
		});
	});

	describe("passthrough tools", () => {
		it("preserves non-function tools like codeExecution", () => {
			const payload: RequestPayload = {
				tools: [
					{ codeExecution: {} },
					{
						function: {
							name: "regular_tool",
							parameters: {
								type: "object",
								properties: { x: { type: "string" } },
							},
						},
					},
				],
			};

			normalizeClaudeTools(payload, identityClean);

			const tools = normalizedTools(payload);
			expect(tools).toHaveLength(2);
			expect(item(tools, 0, "tools[0]")["functionDeclarations"]).toBeDefined();
			expect(item(tools, 1, "tools[1]")["codeExecution"]).toBeDefined();
		});
	});
});

describe("applyClaudeTransforms", () => {
	const mockCleanJSONSchema = (schema: unknown) => record(schema, "JSON schema");

	it("applies tool config for all Claude models", () => {
		const payload: RequestPayload = {};

		applyClaudeTransforms(payload, {
			model: "claude-sonnet-4-6",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const toolConfig = record(payload["toolConfig"], "tool config");
		expect(record(toolConfig["functionCallingConfig"], "function calling config")["mode"]).toBe(
			"VALIDATED",
		);
	});

	it("applies thinking config for thinking models", () => {
		const payload: RequestPayload = {};

		applyClaudeTransforms(payload, {
			model: "claude-opus-4-6-thinking",
			normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const genConfig = record(payload["generationConfig"], "generation config");
		const thinkingConfig = record(genConfig["thinkingConfig"], "thinking config");
		expect(thinkingConfig["include_thoughts"]).toBe(true);
		expect(thinkingConfig["thinking_budget"]).toBe(8192);
	});

	it("uses tierThinkingBudget over normalizedThinking.thinkingBudget", () => {
		const payload: RequestPayload = {};

		applyClaudeTransforms(payload, {
			model: "claude-opus-4-6-thinking",
			tierThinkingBudget: 32768,
			normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const genConfig = record(payload["generationConfig"], "generation config");
		const thinkingConfig = record(genConfig["thinkingConfig"], "thinking config");
		expect(thinkingConfig["thinking_budget"]).toBe(32768);
	});

	it("ensures maxOutputTokens for thinking models with budget", () => {
		const payload: RequestPayload = {
			generationConfig: { maxOutputTokens: 4096 },
		};

		applyClaudeTransforms(payload, {
			model: "claude-opus-4-6-thinking",
			normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const genConfig = record(payload["generationConfig"], "generation config");
		expect(genConfig["maxOutputTokens"]).toBe(computeClaudeMaxOutputTokens(8192));
	});

	it("does not apply thinking config for non-thinking models", () => {
		const payload: RequestPayload = {};

		applyClaudeTransforms(payload, {
			model: "claude-sonnet-4-5",
			normalizedThinking: { includeThoughts: true, thinkingBudget: 8192 },
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const genConfig = optionalRecord(payload["generationConfig"], "generation config");
		expect(genConfig?.["thinkingConfig"]).toBeUndefined();
	});

	it("appends thinking hint for thinking models with tools", () => {
		const payload: RequestPayload = {
			systemInstruction: "You are helpful.",
			tools: [
				{
					function: {
						name: "test",
						parameters: {
							type: "object",
							properties: { x: { type: "string" } },
						},
					},
				},
			],
		};

		applyClaudeTransforms(payload, {
			model: "claude-opus-4-6-thinking",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const parts = systemParts(payload);
		expect(parts.map((part) => part["text"])).toContain(CLAUDE_INTERLEAVED_THINKING_HINT);
	});

	it("does not append thinking hint for thinking models without tools", () => {
		const payload: RequestPayload = {
			systemInstruction: "You are helpful.",
		};

		applyClaudeTransforms(payload, {
			model: "claude-opus-4-6-thinking",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		expect(payload["systemInstruction"]).not.toContain(CLAUDE_INTERLEAVED_THINKING_HINT);
	});

	it("does not append thinking hint for non-thinking models with tools", () => {
		const payload: RequestPayload = {
			systemInstruction: "You are helpful.",
			tools: [
				{
					function: {
						name: "test",
						parameters: {
							type: "object",
							properties: { x: { type: "string" } },
						},
					},
				},
			],
		};

		applyClaudeTransforms(payload, {
			model: "claude-sonnet-4-5",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		expect(payload["systemInstruction"]).not.toContain(CLAUDE_INTERLEAVED_THINKING_HINT);
	});

	it("normalizes tools and returns debug info", () => {
		const payload: RequestPayload = {
			tools: [{ function: { name: "my_tool" } }],
		};

		const result = applyClaudeTransforms(payload, {
			model: "claude-sonnet-4-6",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		expect(result.toolDebugMissing).toBe(1);
		expect(result.toolDebugSummaries).toContain("decl=my_tool,src=function/custom,hasSchema=n");
	});

	it("converts stop_sequences in generationConfig", () => {
		const payload: RequestPayload = {
			generationConfig: { stop_sequences: ["END"] },
		};

		applyClaudeTransforms(payload, {
			model: "claude-sonnet-4-6",
			cleanJSONSchema: mockCleanJSONSchema,
		});

		const genConfig = record(payload["generationConfig"], "generation config");
		expect(genConfig["stopSequences"]).toEqual(["END"]);
		expect(genConfig["stop_sequences"]).toBeUndefined();
	});
});

describe("constants", () => {
	it("exports CLAUDE_THINKING_MAX_OUTPUT_TOKENS", () => {
		expect(CLAUDE_THINKING_MAX_OUTPUT_TOKENS).toBe(64_000);
	});

	it("exports CLAUDE_INTERLEAVED_THINKING_HINT", () => {
		expect(CLAUDE_INTERLEAVED_THINKING_HINT).toContain("Interleaved thinking is enabled");
	});
});
