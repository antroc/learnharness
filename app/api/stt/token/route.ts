/**
 * Acuñado BYOK sin cuerpo POST: el renderer nunca tiene la clave real de
 * Deepgram.
 *
 * La clave vive solo en el servidor (auth.json → process.env en la app de
 * escritorio; .env.local en desarrollo; la misma frontera que
 * OPENROUTER_API_KEY). Una ejecución de dictado empieza aquí: se acuña un
 * token de acceso de vida corta (TTL de 300 s; una ejecución puede durar
 * más que los 30 s por defecto), el renderer abre con él su WebSocket a
 * Deepgram y el audio fluye directamente renderer → Deepgram, nunca a
 * través de este servidor. El token solo se comprueba en el handshake del
 * WebSocket, así que las sesiones de dictado largas sobreviven sin problema
 * al TTL (documentación de Deepgram).
 *
 * NOTA: la clave necesita al menos el permiso Member en la consola de
 * Deepgram para llamar a /auth/grant (su documentación, FAQ de
 * autenticación por token); las claves simples de lectura/transcripción
 * devuelven FORBIDDEN aquí.
 */
import { keyValue } from "@/src/server";

export async function GET() {
	const key = keyValue("DEEPGRAM_API_KEY");
	if (!key) {
		return Response.json(
			{ message: "No DEEPGRAM_API_KEY — add it to auth.json (desktop) or .env.local (dev)." },
			{ status: 503 },
		);
	}

	try {
		const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
			method: "POST",
			headers: { Authorization: `Token ${key}`, "Content-Type": "application/json" },
			body: JSON.stringify({ ttl_seconds: 300 }),
		});
		if (!res.ok) {
			const detail = await res.text();
			return Response.json(
				{ message: `Deepgram token grant failed (${res.status}): ${detail.slice(0, 200)}` },
				{ status: 502 },
			);
		}
		const data = (await res.json()) as { access_token?: string };
		if (!data.access_token) {
			return Response.json({ message: "Deepgram grant returned no token" }, { status: 502 });
		}
		return Response.json({ token: data.access_token });
	} catch {
		return Response.json({ message: "Deepgram unreachable" }, { status: 502 });
	}
}
