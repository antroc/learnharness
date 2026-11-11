import { BlockList, isIP } from "node:net";
import { Agent, buildConnector, fetch as undiciFetch } from "undici";

/**
 * Fetch para URL elegidas por el modelo (web_fetch / web_fetch_pdf de research): solo
 * direcciones públicas de Internet. Una página descargada puede reorientar al investigador, así que
 * sin esto podría leer servicios de loopback, la LAN o los metadatos de la nube
 * (169.254.169.254) y devolver la respuesta al modelo.
 *
 * La comprobación se hace sobre la dirección a la que llega realmente cada conexión, después del DNS
 * y antes de enviar ningún byte de la petición, así que las redirecciones, las URL con IP literal y
 * el DNS rebinding pasan todos por ella.
 */

const NON_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8], // «esta red»
	["10.0.0.0", 8], // privada
	["100.64.0.0", 10], // NAT de operador (CGNAT)
	["127.0.0.0", 8], // loopback
	["169.254.0.0", 16], // enlace local, metadatos de la nube
	["172.16.0.0", 12], // privada
	["192.0.0.0", 24], // asignaciones de protocolo del IETF
	["192.0.2.0", 24], // documentación
	["192.88.99.0", 24], // anycast de relay 6to4
	["192.168.0.0", 16], // privada
	["198.18.0.0", 15], // pruebas de rendimiento (benchmarking)
	["198.51.100.0", 24], // documentación
	["203.0.113.0", 24], // documentación
	["224.0.0.0", 4], // multicast
	["240.0.0.0", 4], // reservada, broadcast
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv4");
for (const [network, prefix] of [
	["::", 128], // sin especificar
	["::1", 128], // loopback
	["64:ff9b::", 96], // NAT64
	["64:ff9b:1::", 48], // NAT64 de uso local
	["100::", 64], // solo descarte
	["2001:db8::", 32], // documentación
	["2002::", 16], // 6to4
	["fc00::", 7], // local única
	["fe80::", 10], // enlace local
	["ff00::", 8], // multicast
] as const) NON_PUBLIC.addSubnet(network, prefix, "ipv6");

/** True cuando una dirección IP está en la Internet pública. Las IPv6 mapeadas desde IPv4
 *  (::ffff:a.b.c.d) se juzgan como la dirección IPv4 que llevan. */
export function isPublicAddress(address: string): boolean {
	const unbracketed = address.replace(/^\[|\]$/g, "");
	const mapped = unbracketed.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
	const ip = mapped ?? unbracketed;
	const family = isIP(ip);
	if (family === 4) return !NON_PUBLIC.check(ip, "ipv4");
	if (family === 6) return !NON_PUBLIC.check(ip, "ipv6");
	return false;
}

export class BlockedAddressError extends Error {}

/** Un Agent de undici cuyas conexiones solo pueden llegar a direcciones que acepte `allowed`
 *  (exportado con la comprobación inyectable, para las pruebas). */
export function createAddressCheckedAgent(
	allowed: (address: string) => boolean = isPublicAddress,
	connectorOptions: Parameters<typeof buildConnector>[0] = {},
): Agent {
	// Los ajustes opcionales del conector permiten que las pruebas sin red aporten un DNS determinista y
	// una CA de TLS sintética. En producción se usa el conector estándar sin cambios.
	const connect = buildConnector(connectorOptions);
	return new Agent({
		connect: (options, callback) => {
			connect(options, (error, socket) => {
				if (error || !socket) {
					callback(error ?? new Error("connection failed"), null);
					return;
				}
				const peer = socket.remoteAddress ?? "";
				if (!peer || !allowed(peer)) {
					socket.destroy();
					callback(new BlockedAddressError(`refusing to connect to a private or local address (${options.hostname})`), null);
					return;
				}
				callback(null, socket);
			});
		},
	});
}

const publicOnly = createAddressCheckedAgent();

/** Punto de inyección para pruebas: undefined en producción. Las pruebas que conducen las herramientas
 *  de investigación sin red ponen aquí un respondedor enlatado (sustituir globalThis.fetch ya no
 *  llega a estas herramientas, que usan el fetch propio de undici). */
export const safeFetchOverride: { current?: (url: string, init: RequestInit) => Promise<Response> } = {};

/** fetch() limitado a direcciones públicas. Un rechazo aflora como su propio
 *  mensaje en lugar del genérico "fetch failed" de undici. */
export async function safeFetch(url: string, init: RequestInit = {}, dispatcher: Agent = publicOnly): Promise<Response> {
	if (safeFetchOverride.current) return safeFetchOverride.current(url, init);
	try {
		return (await undiciFetch(url, { ...(init as object), dispatcher })) as unknown as Response;
	} catch (err) {
		const cause = (err as { cause?: unknown }).cause;
		if (cause instanceof BlockedAddressError) throw new Error(cause.message);
		throw err;
	}
}
