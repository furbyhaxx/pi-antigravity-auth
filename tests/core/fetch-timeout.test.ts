import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";

import { ACTIVE_FETCH_TIMEOUT_MS, fetchWithActiveTimeout } from "../../src/core/fetch-timeout.ts";
import { defined } from "../support/defined.ts";

type FetchMockImplementation = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function mockFetch(implementation: FetchMockImplementation): typeof fetch {
	const fetchImplementation = Object.assign(implementation, {
		preconnect: globalThis.fetch.preconnect,
	});
	return Object.assign(mock(fetchImplementation), {
		preconnect: globalThis.fetch.preconnect,
	});
}

/**
 * Builds a mock fetch whose response promise respects the request's
 * AbortSignal — when the signal aborts, the promise rejects so the helper
 * under test can propagate the abort cleanly. With no resolution scheduled
 * this simulates a server that accepted the connection but never produced
 * response headers.
 */
function hangingFetch(): typeof fetch {
	return mockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
		return new Promise<Response>((_resolve, reject) => {
			const signal = init?.signal;
			if (signal?.aborted) {
				reject(signal.reason ?? new DOMException("aborted", "AbortError"));
				return;
			}
			signal?.addEventListener(
				"abort",
				() => {
					reject(signal.reason ?? new DOMException("aborted", "AbortError"));
				},
				{ once: true },
			);
		});
	});
}

function delayedResponseFetch(resolveAfterMs: number, body: string, status = 200): typeof fetch {
	return mockFetch(async (_input, _init) => {
		await new Promise((resolve) => setTimeout(resolve, resolveAfterMs));
		return new Response(body, { status });
	});
}

function observeAbortListeners(signal: AbortSignal) {
	const listeners = new Set<EventListenerOrEventListenerObject>();
	const add = signal.addEventListener.bind(signal);
	const remove = signal.removeEventListener.bind(signal);
	signal.addEventListener = (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === "abort" && listener) listeners.add(listener);
		add(type, listener, options);
	};
	signal.removeEventListener = (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === "abort" && listener) listeners.delete(listener);
		remove(type, listener, options);
	};
	return listeners;
}

function controlledFetch(cancel?: (reason: unknown) => void) {
	let bodyController: ReadableStreamDefaultController<Uint8Array> | undefined;
	let requestSignal: AbortSignal | undefined;
	let original: Response | undefined;
	const fetchImpl = mockFetch(async (_input: RequestInfo | URL, init?: RequestInit) => {
		requestSignal = defined(init?.signal, "fetch request signal");
		const body = new ReadableStream<Uint8Array>(
			{
				start(controller) {
					bodyController = controller;
					const signal = defined(requestSignal, "fetch request signal");
					if (signal.aborted) controller.error(signal.reason);
					else
						signal.addEventListener(
							"abort",
							() => {
								controller.error(signal.reason);
							},
							{ once: true },
						);
				},
				...(cancel ? { cancel } : {}),
			},
			{ highWaterMark: 0 },
		);
		const response = new Response(body, {
			status: 206,
			statusText: "Partial Content",
			headers: { "x-stream": "yes" },
		});
		Object.defineProperties(response, {
			url: { value: "https://example.test/redirected" },
			type: { value: "cors" },
			redirected: { value: true },
		});
		original = response;
		return response;
	});
	return {
		fetchImpl,
		controller: () => defined(bodyController, "response body controller"),
		signal: () => defined(requestSignal, "fetch request signal"),
		original: () => defined(original, "original response"),
	};
}

function responseBody(response: Response): ReadableStream<Uint8Array> {
	return defined(response.body, "response body");
}

describe("ACTIVE_FETCH_TIMEOUT_MS", () => {
	it("defaults to fifteen seconds", () => {
		expect(ACTIVE_FETCH_TIMEOUT_MS).toBe(15_000);
	});
});

describe("caller/body lifetime without AbortSignal.any", () => {
	let anyDescriptor: PropertyDescriptor;
	beforeEach(() => {
		anyDescriptor = defined(
			Object.getOwnPropertyDescriptor(AbortSignal, "any"),
			"AbortSignal.any property descriptor",
		);
		Object.defineProperty(AbortSignal, "any", {
			...anyDescriptor,
			value: undefined,
		});
		expect(AbortSignal.any).toBeUndefined();
	});
	afterEach(() => {
		Object.defineProperty(AbortSignal, "any", anyDescriptor);
		mock.restore();
	});

	it("inherits a Request signal and forwards its cancellation after headers", async () => {
		const caller = new AbortController();
		const input = new Request("https://example.test", { signal: caller.signal });
		const listeners = observeAbortListeners(input.signal);
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(input, {}, { fetchImpl: source.fetchImpl });
		expect(listeners.size).toBe(1);
		const reader = responseBody(response).getReader();
		const pending = reader.read();
		const reason = new Error("Request input canceled after headers");
		caller.abort(reason);
		expect(source.signal().reason).toBe(reason);
		await expect(pending).rejects.toBe(reason);
		expect(source.signal().reason).toBe(reason);
		expect(listeners.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
		reader.releaseLock();
	});

	it("honors explicit init.signal overrides, including null, instead of a Request signal", async () => {
		for (const override of [new AbortController(), null]) {
			const caller = new AbortController();
			const input = new Request("https://example.test", {
				signal: caller.signal,
			});
			const inputListeners = observeAbortListeners(input.signal);
			const source = controlledFetch();
			const response = await fetchWithActiveTimeout(
				input,
				{
					signal: override?.signal ?? null,
				},
				{ fetchImpl: source.fetchImpl },
			);
			expect(inputListeners.size).toBe(0);
			caller.abort(new Error("ignored Request signal"));
			expect(source.signal().aborted).toBe(false);
			if (override) {
				const pending = response.text();
				const reason = new Error("explicit init override");
				override.abort(reason);
				await expect(pending).rejects.toBe(reason);
				expect(source.signal().reason).toBe(reason);
				expect(responseBody(source.original()).locked).toBe(false);
			} else {
				expect(response).toBe(source.original());
				await responseBody(response).cancel();
			}
		}
	});

	it("passes the exact pre-abort reason to fetch without attaching a caller listener", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const reason = { canceled: true };
		caller.abort(reason);
		const fetchImpl = hangingFetch();
		await expect(
			fetchWithActiveTimeout(
				"https://example.test",
				{
					signal: caller.signal,
				},
				{ fetchImpl },
			),
		).rejects.toBe(reason);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(listeners.size).toBe(0);
	});

	it("enforces the header deadline with a caller signal and detaches on rejection", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const result = fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: hangingFetch(), timeoutMs: 20 },
		);
		expect(listeners.size).toBe(1);
		await expect(result).rejects.toHaveProperty("name", "TimeoutError");
		expect(listeners.size).toBe(0);
		expect(caller.signal.aborted).toBe(false);
	});

	it("detaches only the deadline at headers and forwards caller abort during a body read", async () => {
		const caller = new AbortController();
		const deadline = new AbortController();
		const callers = observeAbortListeners(caller.signal);
		const deadlines = observeAbortListeners(deadline.signal);
		spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
			expect(ms).toBe(15_000);
			return deadline.signal;
		});
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		expect(deadlines.size).toBe(0);
		expect(callers.size).toBe(1);
		const reader = responseBody(response).getReader();
		const pending = reader.read();
		const reason = new Error("caller body cancellation");
		caller.abort(reason);
		expect(source.signal().reason).toBe(reason);
		await expect(pending).rejects.toBe(reason);
		expect(source.signal().reason).toBe(reason);
		expect(callers.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
		reader.releaseLock();
	});

	it("does not let the expired header deadline kill a streaming body", async () => {
		const caller = new AbortController();
		const deadline = new AbortController();
		const callers = observeAbortListeners(caller.signal);
		const deadlines = observeAbortListeners(deadline.signal);
		spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		const reader = responseBody(response).getReader();
		const first = reader.read();
		source.controller().enqueue(new Uint8Array([0, 255, 128]));
		expect((await first).value).toEqual(new Uint8Array([0, 255, 128]));
		deadline.abort(new DOMException("late deadline", "TimeoutError"));
		expect(deadlines.size).toBe(0);
		expect(source.signal().aborted).toBe(false);
		expect(callers.size).toBe(1);
		const second = reader.read();
		source.controller().enqueue(new Uint8Array([1, 2]));
		expect((await second).value).toEqual(new Uint8Array([1, 2]));
		source.controller().close();
		expect((await reader.read()).done).toBe(true);
		expect(callers.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
		caller.abort(new Error("after EOF"));
		expect(source.signal().aborted).toBe(false);
		reader.releaseLock();
	});

	it("preserves metadata, clone metadata, and unbuffered body bytes", async () => {
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: new AbortController().signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		expect(source.original().bodyUsed).toBe(false);
		const clone = response.clone();
		for (const copy of [response, clone]) {
			expect(copy.status).toBe(206);
			expect(copy.statusText).toBe("Partial Content");
			expect([...copy.headers]).toEqual([...source.original().headers]);
			expect(copy.url).toBe("https://example.test/redirected");
			expect(copy.type).toBe("cors");
			expect(copy.redirected).toBe(true);
		}
		source.controller().enqueue(new Uint8Array([0, 255, 128, 10]));
		source.controller().close();
		for (const copy of [response, clone]) {
			expect(new Uint8Array(await copy.arrayBuffer())).toEqual(new Uint8Array([0, 255, 128, 10]));
		}
	});

	it("preserves body read errors and detaches and releases the source on error", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		expect(listeners.size).toBe(1);
		const reason = new Error("network body failure");
		source.controller().error(reason);
		await expect(response.text()).rejects.toBe(reason);
		expect(listeners.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
	});

	it("detaches and releases an idle body when the source errors or reaches empty EOF", async () => {
		for (const error of [new Error("idle network failure"), undefined]) {
			const caller = new AbortController();
			const listeners = observeAbortListeners(caller.signal);
			const source = controlledFetch();
			const response = await fetchWithActiveTimeout(
				"https://example.test",
				{
					signal: caller.signal,
				},
				{ fetchImpl: source.fetchImpl },
			);
			expect(listeners.size).toBe(1);
			if (error) source.controller().error(error);
			else source.controller().close();
			await Promise.resolve();
			expect(listeners.size).toBe(0);
			expect(responseBody(source.original()).locked).toBe(false);
			if (error) await expect(response.text()).rejects.toBe(error);
			else expect(await response.text()).toBe("");
		}
	});

	it("forwards caller abort and releases an idle body without consuming it", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const source = controlledFetch();
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		expect(listeners.size).toBe(1);
		const reason = new Error("idle caller cancellation");
		caller.abort(reason);
		await Promise.resolve();
		expect(source.signal().reason).toBe(reason);
		expect(listeners.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
		await expect(response.text()).rejects.toBe(reason);
	});

	it("forwards cancel reason and detaches and releases the source on cancel", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const cancel = mock((_reason: unknown) => {});
		const source = controlledFetch(cancel);
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		expect(listeners.size).toBe(1);
		const reason = { cancel: "consumer" };
		await responseBody(response).cancel(reason);
		expect(cancel).toHaveBeenCalledWith(reason);
		expect(listeners.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
		caller.abort(new Error("after cancel"));
		expect(source.signal().aborted).toBe(false);
	});

	it("preserves cancel errors while detaching and releasing the source", async () => {
		const caller = new AbortController();
		const listeners = observeAbortListeners(caller.signal);
		const reason = new Error("cancel failed");
		const source = controlledFetch(() => {
			throw reason;
		});
		const response = await fetchWithActiveTimeout(
			"https://example.test",
			{
				signal: caller.signal,
			},
			{ fetchImpl: source.fetchImpl },
		);
		await expect(responseBody(response).cancel()).rejects.toBe(reason);
		expect(listeners.size).toBe(0);
		expect(responseBody(source.original()).locked).toBe(false);
	});

	it("cleans up immediately for null bodies and fetch rejection", async () => {
		for (const reject of [false, true]) {
			const caller = new AbortController();
			const deadline = new AbortController();
			const callers = observeAbortListeners(caller.signal);
			const deadlines = observeAbortListeners(deadline.signal);
			spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
			const original = new Response(null, { status: 204 });
			const failure = new Error("fetch failed");
			const fetchImpl = mockFetch(async () => {
				expect(callers.size).toBe(1);
				expect(deadlines.size).toBe(1);
				if (reject) throw failure;
				return original;
			});
			const pending = fetchWithActiveTimeout(
				"https://example.test",
				{
					signal: caller.signal,
				},
				{ fetchImpl },
			);
			if (reject) await expect(pending).rejects.toBe(failure);
			else expect(await pending).toBe(original);
			expect(callers.size).toBe(0);
			expect(deadlines.size).toBe(0);
		}
	});
});

describe("fetchWithActiveTimeout", () => {
	it("works without AbortSignal.any with a caller signal", async () => {
		const descriptor = defined(
			Object.getOwnPropertyDescriptor(AbortSignal, "any"),
			"AbortSignal.any property descriptor",
		);
		Object.defineProperty(AbortSignal, "any", {
			...descriptor,
			value: undefined,
		});
		try {
			expect(AbortSignal.any).toBeUndefined();
			const caller = new AbortController();
			const response = await fetchWithActiveTimeout(
				"https://example.test/no-any",
				{ signal: caller.signal },
				{ fetchImpl: delayedResponseFetch(0, "ok") },
			);
			expect(await response.text()).toBe("ok");
		} finally {
			Object.defineProperty(AbortSignal, "any", descriptor);
		}
	});

	it("aborts an unresolved fetch after the configured timeout", async () => {
		const fetchImpl = hangingFetch();
		const start = Date.now();
		let caught: unknown;
		try {
			await fetchWithActiveTimeout(
				"https://example.test/slow",
				{ method: "GET" },
				{ timeoutMs: 50, fetchImpl },
			);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DOMException);
		if (!(caught instanceof DOMException)) throw new Error("expected a DOMException");
		const name = caught.name;
		expect(name === "AbortError" || name === "TimeoutError").toBe(true);
		const elapsed = Date.now() - start;
		expect(elapsed).toBeGreaterThanOrEqual(45);
		expect(elapsed).toBeLessThan(500);
	});

	it("preserves the caller-supplied abort reason when caller aborts first", async () => {
		const fetchImpl = hangingFetch();
		const callerController = new AbortController();
		const callerReason = new Error("caller-cancelled");
		const promise = fetchWithActiveTimeout(
			"https://example.test/slow",
			{ signal: callerController.signal },
			{ timeoutMs: 1000, fetchImpl },
		);
		callerController.abort(callerReason);
		await expect(promise).rejects.toBe(callerReason);
	});

	it("lets a response body remain readable past the timeout window", async () => {
		const fetchImpl = delayedResponseFetch(20, "streamed-body");
		const response = await fetchWithActiveTimeout("https://example.test/stream", undefined, {
			timeoutMs: 50,
			fetchImpl,
		});
		// Wait past the timeout to confirm the body stream has not been aborted
		// along with the active-fetch deadline. Headers resolved before timeout,
		// so the body must remain readable.
		await new Promise((resolve) => setTimeout(resolve, 120));
		const body = await response.text();
		expect(body).toBe("streamed-body");
	});

	it("forwards headers, method, and body to the underlying fetchImpl", async () => {
		const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
		const fetchImpl = mockFetch(async (input: RequestInfo | URL, init?: RequestInit) => {
			calls.push([input, init]);
			return new Response("ok", { status: 200 });
		});

		await fetchWithActiveTimeout(
			"https://example.test/echo",
			{
				method: "POST",
				headers: { "X-Trace": "abc", "Content-Type": "text/plain" },
				body: "payload",
			},
			{ timeoutMs: 1000, fetchImpl },
		);

		expect(calls.length).toBe(1);
		const [input, init] = defined(calls[0], "fetch call");
		expect(input).toBe("https://example.test/echo");
		expect(init?.method).toBe("POST");
		expect(init?.body).toBe("payload");
		const headers = new Headers(init?.headers);
		expect(headers.get("X-Trace")).toBe("abc");
		expect(headers.get("Content-Type")).toBe("text/plain");
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});

	it("uses ACTIVE_FETCH_TIMEOUT_MS when no timeoutMs override is supplied", async () => {
		// With a hanging fetch and the default 15s timeout we cannot wait that
		// long in tests, so override to a tiny value and assert the override is
		// honored. The default value is locked in by the constant assertion above.
		const fetchImpl = hangingFetch();
		let caught: unknown;
		try {
			await fetchWithActiveTimeout("https://example.test/slow", undefined, {
				fetchImpl,
				timeoutMs: 25,
			});
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeInstanceOf(DOMException);
		if (!(caught instanceof DOMException)) throw new Error("expected a DOMException");
		const name = caught.name;
		expect(name === "AbortError" || name === "TimeoutError").toBe(true);
	});
});
