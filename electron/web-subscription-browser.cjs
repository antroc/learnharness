"use strict";

/** El escritorio en desarrollo no tiene pestañas. Resuelve solo una acción
 * opaca sobre su propio servidor de Next y después abre fuera del renderer la
 * página del proveedor validada por el responsable. El llamante debe
 * autenticar antes el marco principal de confianza de su app. */
async function openWebSubscriptionBrowser(action, origin, { fetch: request = globalThis.fetch, openExternal }) {
	if (typeof action !== "string" || !/^\/api\/subscriptions\/browser\?id=[0-9a-f-]{36}$/.test(action)) throw new Error("Invalid sign-in action.");
	const response = await request(new URL(action, origin), {
		method: "POST", redirect: "manual", credentials: "omit",
		headers: { origin, "x-learnharness-subscriptions": "1" },
		signal: AbortSignal.timeout(15000),
	});
	const target = response.headers.get("location");
	if (response.status !== 303 || !target) throw new Error("Sign-in action expired.");
	const parsed = new URL(target);
	if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("Invalid provider page.");
	await openExternal(target);
}
module.exports = { openWebSubscriptionBrowser };
