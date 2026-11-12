/** Fixture de proceso hijo (#403): `create` crea un chat e imprime su id;
 *  `crash <id>` muere justo antes de que se produzca el guardado de ese chat; `read <id>`
 *  informa de lo que ven los arranques nuevos. Se ejecuta sobre el LH_DATA_DIR del llamador. */
import fs from "node:fs";
const [mode, id = ""] = process.argv.slice(2);
const { chatStore } = await import("../../src/store/chats.ts");
const { PATHS } = await import("../../config.ts");
if (mode === "create") {
	const chat = chatStore.createChat("Crash fixture");
	chatStore.saveMessages(chat.id, [{ role: "user", content: "first", timestamp: 1 }] as never);
	console.log(chat.id);
} else if (mode === "crash") {
	const rename = fs.renameSync;
	fs.renameSync = (...args: Parameters<typeof rename>) => {
		if (String(args[1]).endsWith(`${id}.json`)) process.exit(77);
		return rename(...args);
	};
	chatStore.saveMessages(id, [{ role: "user", content: "second", timestamp: 2 }] as never);
} else {
	console.log(JSON.stringify({
		chat: chatStore.getChat(id),
		listed: chatStore.listChats().map((c) => c.id),
		files: fs.readdirSync(PATHS.chats),
	}));
}
