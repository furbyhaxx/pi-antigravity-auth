import { describe, expect, it } from "bun:test";
import {
	getModelFamily,
	sanitizeCrossModelPayload,
} from "../../../src/core/transform/cross-model-sanitizer.ts";

function defined<T>(value: T | undefined | null, what: string): T {
	if (value == null) throw new Error(`missing ${what}`);
	return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (!isRecord(value)) throw new Error(`invalid ${what}: expected an object`);
	return value;
}

function array(value: unknown, what: string): unknown[] {
	if (!Array.isArray(value)) throw new Error(`invalid ${what}: expected an array`);
	return value;
}

function item<T>(values: readonly T[], index: number, what: string): T {
	return defined(values[index], what);
}

function records(value: unknown, what: string): Record<string, unknown>[] {
	return array(value, what).map((entry, index) => record(entry, `${what}[${index}]`));
}

describe("Cross-Model Session Integration", () => {
	describe("Gemini → Claude model switch with tool calls", () => {
		it("sanitizes Gemini thinking metadata when preparing Claude request", () => {
			const geminiSessionHistory = {
				contents: [
					{
						role: "user",
						parts: [
							{
								text: "Check disk space. Think about which filesystems are most utilized.",
							},
						],
					},
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "I need to analyze disk usage...",
								thoughtSignature: "EsgQCsUQAXLI2nybuafAE150LGTo2r78fakesig",
							},
							{
								functionCall: { name: "bash", args: { command: "df -h" } },
								metadata: {
									google: {
										thoughtSignature: "EsgQCsUQAXLI2nybuafAE150LGTo2r78fakesig",
									},
								},
							},
						],
					},
					{
						role: "function",
						parts: [
							{
								functionResponse: {
									name: "bash",
									response: { output: "Filesystem Size Used Avail Use%..." },
								},
							},
						],
					},
					{
						role: "model",
						parts: [{ text: "The root filesystem is 62% utilized..." }],
					},
				],
			};

			const payload = {
				model: "claude-opus-4-6-thinking-medium",
				...geminiSessionHistory,
				contents: [
					...geminiSessionHistory.contents,
					{
						role: "user",
						parts: [{ text: "Now check memory usage with free -h" }],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-opus-4-6-thinking-medium",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const contents = records(sanitized["contents"], "contents");
			const model = item(contents, 1, "contents[1]");
			const modelParts = records(model["parts"], "contents[1].parts");

			expect(item(modelParts, 0, "contents[1].parts[0]")["thoughtSignature"]).toBeUndefined();
			expect(item(modelParts, 1, "contents[1].parts[1]")["metadata"]).toBeUndefined();
			expect(
				record(item(modelParts, 1, "contents[1].parts[1]")["functionCall"], "function call")[
					"name"
				],
			).toBe("bash");

			expect(result.modified).toBe(true);
			expect(result.signaturesStripped).toBeGreaterThan(0);
		});

		it("preserves non-signature metadata", () => {
			const payload = {
				contents: [
					{
						role: "model",
						parts: [
							{
								functionCall: { name: "read", args: { path: "/etc/passwd" } },
								metadata: {
									google: {
										thoughtSignature: "should-be-stripped",
										groundingMetadata: { searchQueries: ["test"] },
										searchEntryPoint: { renderedContent: "test" },
									},
									cache_control: { type: "ephemeral" },
								},
							},
						],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-sonnet-4",
				preserveNonSignatureMetadata: true,
			});

			const sanitized = record(result.payload, "sanitized payload");
			const contents = records(sanitized["contents"], "contents");
			const firstContent = item(contents, 0, "contents[0]");
			const parts = records(firstContent["parts"], "contents[0].parts");
			const firstPart = item(parts, 0, "contents[0].parts[0]");
			const partMeta = record(firstPart["metadata"], "part metadata");
			const googleMeta = record(partMeta["google"], "Google metadata");
			const cacheControl = record(partMeta["cache_control"], "cache control metadata");

			expect(googleMeta["thoughtSignature"]).toBeUndefined();
			expect(googleMeta["groundingMetadata"]).toEqual({ searchQueries: ["test"] });
			expect(googleMeta["searchEntryPoint"]).toEqual({ renderedContent: "test" });
			expect(cacheControl["type"]).toBe("ephemeral");
		});

		it("handles the exact bug reproduction scenario from issue", () => {
			const payload = {
				model: "claude-opus-4-6-thinking-medium",
				contents: [
					{
						role: "user",
						parts: [
							{
								text: "Check how much disk space is available using df -h. Think about which filesystems are most utilized.",
							},
						],
					},
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "Let me analyze the disk space request. The user wants to see disk usage and understand filesystem utilization patterns...",
								thoughtSignature:
									"EsgQCsUQAXLI2nybuafAE150LGTo2r78VeryLongSignatureStringThatExceeds50Characters",
							},
							{
								functionCall: {
									name: "Bash",
									args: {
										command: "df -h",
										description: "Check disk space availability",
									},
								},
								metadata: {
									google: {
										thoughtSignature:
											"EsgQCsUQAXLI2nybuafAE150LGTo2r78VeryLongSignatureStringThatExceeds50Characters",
									},
								},
							},
						],
					},
					{
						role: "function",
						parts: [
							{
								functionResponse: {
									name: "Bash",
									response: {
										output:
											"Filesystem      Size  Used Avail Use% Mounted on\noverlay          59G   37G   20G  65% /\ntmpfs            64M     0   64M   0% /dev\n",
									},
								},
							},
						],
					},
					{
						role: "model",
						parts: [
							{
								text: "Based on the disk space analysis, the root overlay filesystem is 65% utilized with 37G used out of 59G total.",
							},
						],
					},
					{
						role: "user",
						parts: [{ text: "Now check memory usage with free -h" }],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-opus-4-6-thinking-medium",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const contents = records(sanitized["contents"], "contents");
			const model = item(contents, 1, "contents[1]");
			const modelParts = records(model["parts"], "contents[1].parts");
			const thinkingPart = item(modelParts, 0, "contents[1].parts[0]");
			const toolPart = item(modelParts, 1, "contents[1].parts[1]");
			expect(thinkingPart["thoughtSignature"]).toBeUndefined();
			expect(thinkingPart["thought"]).toBe(true);
			expect(thinkingPart["text"]).toContain("analyze the disk space");

			expect(toolPart["metadata"]).toBeUndefined();
			expect(record(toolPart["functionCall"], "function call")["name"]).toBe("Bash");

			expect(result.signaturesStripped).toBe(2);
		});
	});

	describe("Claude → Gemini model switch", () => {
		it("sanitizes Claude thinking blocks when preparing Gemini request", () => {
			const payload = {
				extra_body: {
					messages: [
						{
							role: "assistant",
							content: [
								{
									type: "thinking",
									thinking: "Analyzing the request...",
									signature:
										"claude-signature-abc123VeryLongSignatureStringThatExceeds50Characters",
								},
								{
									type: "tool_use",
									id: "tool_1",
									name: "bash",
									input: { command: "ls" },
								},
							],
						},
					],
				},
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "gemini-3-pro-low",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const extraBody = record(sanitized["extra_body"], "extra body");
			const messages = records(extraBody["messages"], "extra_body.messages");
			const assistant = item(messages, 0, "extra_body.messages[0]");
			const content = records(assistant["content"], "assistant content");
			const thinkingBlock = defined(
				content.find((part) => part["type"] === "thinking"),
				"thinking block",
			);

			expect(thinkingBlock["signature"]).toBeUndefined();
			expect(thinkingBlock["thinking"]).toBe("Analyzing the request...");

			const toolBlock = defined(
				content.find((part) => part["type"] === "tool_use"),
				"tool use block",
			);
			expect(toolBlock["name"]).toBe("bash");
		});

		it("strips redacted_thinking blocks", () => {
			const payload = {
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "redacted_thinking",
								data: "encrypted_data_here",
								signature: "redacted-sig-VeryLongSignatureStringThatExceeds50Characters",
							},
							{ type: "text", text: "Here is my response" },
						],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "gemini-3-flash",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const messages = records(sanitized["messages"], "messages");
			const assistant = item(messages, 0, "messages[0]");
			const content = records(assistant["content"], "messages[0].content");
			const redactedBlock = item(content, 0, "messages[0].content[0]");

			expect(redactedBlock["signature"]).toBeUndefined();
			expect(redactedBlock["type"]).toBe("redacted_thinking");
		});
	});

	describe("Same model family - no sanitization needed", () => {
		it("preserves Gemini signatures when staying on Gemini", () => {
			const payload = {
				contents: [
					{
						role: "model",
						parts: [
							{
								thought: true,
								text: "thinking...",
								thoughtSignature: "valid-gemini-sig",
							},
						],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "gemini-3-flash",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const contents = records(sanitized["contents"], "contents");
			const firstContent = item(contents, 0, "contents[0]");
			const parts = records(firstContent["parts"], "contents[0].parts");
			expect(item(parts, 0, "contents[0].parts[0]")["thoughtSignature"]).toBe("valid-gemini-sig");
			expect(result.modified).toBe(false);
		});

		it("preserves Claude signatures when staying on Claude", () => {
			const payload = {
				messages: [
					{
						role: "assistant",
						content: [
							{
								type: "thinking",
								thinking: "analyzing...",
								signature: "valid-claude-sig",
							},
						],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-opus-4-6-thinking-low",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const messages = records(sanitized["messages"], "messages");
			const assistant = item(messages, 0, "messages[0]");
			const content = records(assistant["content"], "messages[0].content");
			expect(item(content, 0, "messages[0].content[0]")["signature"]).toBe("valid-claude-sig");
			expect(result.modified).toBe(false);
		});
	});

	describe("Model family detection", () => {
		it("correctly identifies Gemini models", () => {
			expect(getModelFamily("gemini-3-pro-low")).toBe("gemini");
			expect(getModelFamily("gemini-3-flash")).toBe("gemini");
			expect(getModelFamily("gemini-2.5-pro")).toBe("gemini");
			expect(getModelFamily("gemini-3-pro-high")).toBe("gemini");
		});

		it("correctly identifies Claude models", () => {
			expect(getModelFamily("claude-opus-4-6-thinking-medium")).toBe("claude");
			expect(getModelFamily("claude-sonnet-4-6")).toBe("claude");
			expect(getModelFamily("claude-sonnet-4")).toBe("claude");
			expect(getModelFamily("claude-3-opus")).toBe("claude");
		});

		it("returns unknown for unrecognized models", () => {
			expect(getModelFamily("gpt-4")).toBe("unknown");
			expect(getModelFamily("llama-3")).toBe("unknown");
		});
	});

	describe("Edge cases", () => {
		it("handles empty payloads", () => {
			const result = sanitizeCrossModelPayload({}, { targetModel: "claude-sonnet-4" });
			expect(result.modified).toBe(false);
			expect(result.signaturesStripped).toBe(0);
		});

		it("handles null/undefined parts gracefully", () => {
			const payload = {
				contents: [
					{ role: "user", parts: null },
					{ role: "model", parts: undefined },
					{ role: "model" },
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-sonnet-4",
			});

			expect(result.modified).toBe(false);
		});

		it("handles wrapped requests array (batch format)", () => {
			const payload = {
				requests: [
					{
						contents: [
							{
								role: "model",
								parts: [
									{
										thoughtSignature: "sig1",
										thought: true,
										text: "thinking",
									},
								],
							},
						],
					},
					{
						contents: [
							{
								role: "model",
								parts: [
									{
										metadata: { google: { thoughtSignature: "sig2" } },
										functionCall: { name: "test" },
									},
								],
							},
						],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "claude-sonnet-4-6",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const requests = records(sanitized["requests"], "requests");
			const firstRequest = item(requests, 0, "requests[0]");
			const firstContents = records(firstRequest["contents"], "requests[0].contents");
			const firstContent = item(firstContents, 0, "requests[0].contents[0]");
			const firstParts = records(firstContent["parts"], "requests[0].contents[0].parts");
			const firstPart = item(firstParts, 0, "requests[0].contents[0].parts[0]");
			expect(firstPart["thoughtSignature"]).toBeUndefined();

			const secondRequest = item(requests, 1, "requests[1]");
			const secondContents = records(secondRequest["contents"], "requests[1].contents");
			const secondContent = item(secondContents, 0, "requests[1].contents[0]");
			const secondParts = records(secondContent["parts"], "requests[1].contents[0].parts");
			expect(item(secondParts, 0, "requests[1].contents[0].parts[0]")["metadata"]).toBeUndefined();
			expect(result.signaturesStripped).toBe(2);
		});

		it("handles unknown target model by skipping sanitization", () => {
			const payload = {
				contents: [
					{
						role: "model",
						parts: [{ thoughtSignature: "sig", thought: true, text: "hi" }],
					},
				],
			};

			const result = sanitizeCrossModelPayload(payload, {
				targetModel: "gpt-4-turbo",
			});

			const sanitized = record(result.payload, "sanitized payload");
			const contents = records(sanitized["contents"], "contents");
			const firstContent = item(contents, 0, "contents[0]");
			const parts = records(firstContent["parts"], "contents[0].parts");
			expect(item(parts, 0, "contents[0].parts[0]")["thoughtSignature"]).toBe("sig");
			expect(result.modified).toBe(false);
		});
	});
});
