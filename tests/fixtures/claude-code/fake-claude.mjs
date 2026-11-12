/**
 * Sustituto de la CLI claude en las pruebas. Lee la entrada stream-json de
 * stdin y luego reproduce línea a línea el fichero de escenario indicado por
 * FAKE_CLAUDE_SCENARIO. Las líneas con una clave "fake" son directivas en vez de salida:
 *   {"fake":"hold"}                          sigue vivo hasta que lo maten, como la CLI esperando una llamada MCP retenida
 *   {"fake":"exit","code":1,"stderr":"..."}  escribe stderr y sale con ese código
 *   {"fake":"call","id":"toolu_...","name":"read","arguments":{...}}  llama al puente MCP y espera su resultado
 *   {"fake":"start-call",...}                inicia la misma petición sin esperar su resultado
 *   {"fake":"cancel-call","id":"toolu_..."} cancela una petición MCP pendiente concreta
 *   {"fake":"checkpoint"}                   avisa al padre cuando terminan los envíos anteriores
 *   {"fake":"wait-for-message"}              se pausa hasta que la prueba libera al hijo por IPC
 *   {"fake":"ignore-term"}                   ignora SIGTERM para ejercitar la escalada de la terminación
 *   {"fake":"reply"}                         emite un mensaje del asistente cuyo texto son todos los resultados hasta ahora, unidos por " | "
 * FAKE_CLAUDE_STDIN, si está definido, recibe el stdin que leyó.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { on } from "node:events";
import { createInterface } from "node:readline";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const parentMessages = on(process, "message");
const HOLD_INTERVAL_MS = 60_000;
const BRIDGE_SERVER_NAME = "learnharness";

function writeLine(line) {
	return new Promise((resolve) => process.stdout.write(`${line}\n`, resolve));
}

function streamEvent(event) {
	return JSON.stringify({ type: "stream_event", event });
}

let lastSend = Promise.resolve();

async function connectBridge(mcpConfig) {
	const { url, headers } = JSON.parse(mcpConfig).mcpServers[BRIDGE_SERVER_NAME];
	const client = new Client({ name: "fake-claude", version: "1.0.0" });

	const transport = new StreamableHTTPClientTransport(new URL(url), { requestInit: { headers } });
	const send = transport.send.bind(transport);
	transport.send = (...args) => (lastSend = send(...args));
	await client.connect(transport);
	return client;
}

async function writeReply(text) {
	await writeLine(streamEvent({ type: "message_start", message: { usage: {} } }));
	await writeLine(streamEvent({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }));
	await writeLine(streamEvent({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }));
	await writeLine(streamEvent({ type: "content_block_stop", index: 0 }));
	await writeLine(streamEvent({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: {} }));
	await writeLine(streamEvent({ type: "message_stop" }));
}

const mcpConfig = readFileSync(process.argv[process.argv.indexOf("--mcp-config") + 1], "utf8");

let input = "";
let receiveUser;
const userReceived = new Promise((resolve) => { receiveUser = resolve; });
createInterface({ input: process.stdin }).on("line", async (line) => {
	input += `${line}\n`;
	const message = JSON.parse(line);
	if (message.type !== "control_request") {
		if (process.env.FAKE_CLAUDE_STDIN) writeFileSync(process.env.FAKE_CLAUDE_STDIN, input);
		receiveUser(); return;
	}
	if (message.request.subtype === "initialize") {
		if (process.env.FAKE_CLAUDE_INIT === "ignore") return;
		await writeLine(JSON.stringify({ type: "control_response", response: {
			request_id: message.request_id, subtype: process.env.FAKE_CLAUDE_INIT === "error" ? "error" : "success",
			response: {}, error: "unsupported initialize",
		} }));
	} else if (message.request.subtype === "get_context_usage") {
		await writeLine(JSON.stringify({ type: "control_response", response: {
			request_id: message.request_id, subtype: "success",
			response: { maxTokens: process.env.FAKE_CLAUDE_WINDOW ? JSON.parse(process.env.FAKE_CLAUDE_WINDOW) : null },
		} }));
	}
});
await userReceived;

let bridge = null;
const results = [];
const pendingResults = [];
const controllers = new Map();
const cancelled = new Set();
const lines = readFileSync(process.env.FAKE_CLAUDE_SCENARIO, "utf8").split("\n").filter(Boolean);
for (const line of lines) {
	const directive = JSON.parse(line);

	if (directive.fake === "cancel-call") {
		cancelled.add(directive.id);
		controllers.get(directive.id)?.abort("cancelled by fake CLI");
		await lastSend;
		continue;
	}
	if (directive.fake === "checkpoint") {
		await lastSend;
		process.send?.({ fake: "checkpoint" });
		continue;
	}
	if (directive.fake === "wait-for-message") {
		await parentMessages.next();
		continue;
	}
	if (directive.fake === "hold") {
		setInterval(() => {}, HOLD_INTERVAL_MS);
		break;
	}

	if (directive.fake === "exit") {
		process.stderr.write(directive.stderr ?? "");
		process.exit(directive.code);
	}

	if (directive.fake === "ignore-term") {
		process.on("SIGTERM", () => {});
		continue;
	}
	if (directive.fake === "call" || directive.fake === "start-call") {
		bridge ??= await connectBridge(mcpConfig);
		const controller = new AbortController();
		controllers.set(directive.id, controller);
		const request = bridge.callTool({
			name: directive.name,
			arguments: directive.arguments,
			...(directive.id !== undefined ? { _meta: { "claudecode/toolUseId": directive.id } } : {}),
		}, undefined, { signal: controller.signal });
		if (directive.fake === "start-call") {
			pendingResults.push({ id: directive.id, request });
			void request.catch(() => {});
			await lastSend;
		} else {
			const result = await request;
			results.push(result.content.map((block) => block.text).join(""));
		}
		continue;
	}
	if (directive.fake === "reply") {
		for (const result of await Promise.all(pendingResults.splice(0).filter(({ id }) => !cancelled.has(id)).map(({ request }) => request))) results.push(result.content.map((block) => block.text).join(""));
		await writeReply(results.join(" | "));
		continue;
	}

	await writeLine(line);
}
