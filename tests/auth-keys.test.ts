/**
 * El catálogo curado de claves de autenticación + las reglas de forma (oleada
 * de claves de autenticación, 2026-09-19; oleada de búsqueda 2026-09-20: se
 * retiró la pareja de Google CSE y entraron Tavily + Brave); módulo PURO, así
 * que este fichero no tiene fs propio. Decisiones del responsable que se fijan:
 *  - el catálogo contiene las claves conocidas, ids = nombres de variables de entorno;
 *  - la validación es SOLO DE FORMA (sin pings en directo) y los pegados erróneos son 400;
 *  - el enmascarado es los últimos 4 + la longitud: el texto en claro nunca sale del almacén.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AUTH_KEYS, genericProviderKeyGuard, isKnownAuthKey, maskKey, validateKeyShape } from "../src/core/auth-keys.ts";

describe("the catalog", () => {
	it("lists the curated app-service keys (provider keys live in the provider table)", () => {
		assert.deepEqual(
			AUTH_KEYS.map((k) => k.id),
			["DEEPGRAM_API_KEY", "TAVILY_API_KEY", "BRAVE_API_KEY", "EXA_API_KEY", "FIRECRAWL_API_KEY", "OLLAMA_API_KEY"],
		);
		for (const k of AUTH_KEYS) {
			assert.ok(k.label.length > 0, `${k.id} has a label`);
			assert.ok(k.description.length > 0, `${k.id} has a description`);
			assert.ok(k.docsUrl.startsWith("https://"), `${k.id} has a docs link`);
		}
		// OPENROUTER_API_KEY se graduó a la tabla de proveedores (decisión del responsable,
		// interludio de claves de proveedor): ya no está curada. La pareja de Google CSE
		// se retiró con su motor (oleada de búsqueda, 2026-09-20).
		assert.ok(!isKnownAuthKey("OPENROUTER_API_KEY"));
		assert.ok(!isKnownAuthKey("GOOGLE_SEARCH_API_KEY"), "the CSE pair is retired");
		assert.ok(!isKnownAuthKey("GOOGLE_CSE_ID"));
	});

	it("isKnownAuthKey: catalog yes, everything else no", () => {
		assert.ok(isKnownAuthKey("DEEPGRAM_API_KEY"));
		assert.ok(isKnownAuthKey("TAVILY_API_KEY"));
		assert.ok(isKnownAuthKey("BRAVE_API_KEY"));
		assert.ok(isKnownAuthKey("EXA_API_KEY"));
		assert.ok(isKnownAuthKey("FIRECRAWL_API_KEY"));
		assert.ok(isKnownAuthKey("OLLAMA_API_KEY"));
		assert.ok(!isKnownAuthKey("OPENROUTER_API_KEY"));
		assert.ok(!isKnownAuthKey("OPENAI_API_KEY"), "provider vars are a separate surface");
		assert.ok(!isKnownAuthKey("FUTURE_PLANS_TOKEN"));
		assert.ok(!isKnownAuthKey(""));
	});
});

describe("validateKeyShape (the 400 gate — curated keys)", () => {
	it("Tavily: tvly- prefix required, length floor past it", () => {
		assert.ok(validateKeyShape("TAVILY_API_KEY", "tvly-abc123def456ghi78").ok);
		assert.ok(!validateKeyShape("TAVILY_API_KEY", "sk-or-v1-abcdefghij").ok, "wrong family");
		assert.ok(!validateKeyShape("TAVILY_API_KEY", "tvly-").ok, "prefix alone is a truncation");
		assert.ok(!validateKeyShape("TAVILY_API_KEY", "  ").ok, "empty fails");
	});

	it("Firecrawl: fc- prefix required, length floor past it", () => {
		assert.ok(validateKeyShape("FIRECRAWL_API_KEY", "fc-0123456789abcdef0123456789abcdef").ok);
		assert.ok(!validateKeyShape("FIRECRAWL_API_KEY", "tvly-abc123def456ghi78").ok, "wrong family");
		assert.ok(!validateKeyShape("FIRECRAWL_API_KEY", "fc-").ok, "prefix alone is a truncation");
		assert.ok(!validateKeyShape("FIRECRAWL_API_KEY", "fc-0123456789 abcdef0123").ok, "whitespace fails");
		assert.ok(!validateKeyShape("FIRECRAWL_API_KEY", "  ").ok, "empty fails");
	});

	it("Brave: no public format — a ≥20-char truncation guard, no whitespace", () => {
		assert.ok(validateKeyShape("BRAVE_API_KEY", "b".repeat(40)).ok);
		assert.ok(!validateKeyShape("BRAVE_API_KEY", "b".repeat(19)).ok, "truncated paste");
		assert.ok(!validateKeyShape("BRAVE_API_KEY", "has whitespace here").ok);
	});

	it("Deepgram: no public format — a ≥20-char truncation guard, no whitespace", () => {
		assert.ok(validateKeyShape("DEEPGRAM_API_KEY", "a".repeat(40)).ok);
		assert.ok(!validateKeyShape("DEEPGRAM_API_KEY", "a".repeat(19)).ok, "truncated paste");
		assert.ok(!validateKeyShape("DEEPGRAM_API_KEY", "a b c d e f g h i j k l m n o p q r s").ok, "whitespace");
	});

	it("Exa: accepts whitespace-free keys without assuming a prefix", () => {
		assert.ok(validateKeyShape("EXA_API_KEY", "exa-test-12345678").ok);
		assert.ok(!validateKeyShape("EXA_API_KEY", "short").ok);
		assert.ok(!validateKeyShape("EXA_API_KEY", "exa key with spaces").ok);
	});

	it("Ollama hosted search: ordinary key paste hygiene, not a model URL", () => {
		assert.ok(validateKeyShape("OLLAMA_API_KEY", "  ollama-fake-key-123456  ").ok);
		assert.ok(!validateKeyShape("OLLAMA_API_KEY", "short").ok);
		assert.ok(!validateKeyShape("OLLAMA_API_KEY", "ollama fake key 123456").ok);
		assert.ok(!isKnownAuthKey("OLLAMA_BASE_URL"));
	});

	it("trims surrounding paste whitespace before checking", () => {
		assert.ok(validateKeyShape("DEEPGRAM_API_KEY", `  ${"d".repeat(40)}  `).ok);
	});

	it("unknown ids are rejected with the supported list", () => {
		const r = validateKeyShape("SOMETHING_ELSE", "whatever");
		assert.ok(!r.ok);
		if (!r.ok) assert.match(r.error, /SOMETHING_ELSE.*DEEPGRAM_API_KEY/);
	});
});

describe("genericProviderKeyGuard (model-provider keys — paste hygiene only)", () => {
	it("accepts any ≥12-char whitespace-free value (families vary)", () => {
		assert.deepEqual(genericProviderKeyGuard("OPENROUTER_API_KEY", "sk-or-v1-abc123"), { ok: true });
		assert.deepEqual(genericProviderKeyGuard("OPENAI_API_KEY", "whaterver-value-here"), { ok: true });
		assert.deepEqual(genericProviderKeyGuard("HF_TOKEN", "hf_xxxxxxxx9999"), { ok: true });
	});

	it("rejects truncations and whitespace — the only guards", () => {
		const short = genericProviderKeyGuard("ZAI_API_KEY", "short");
		assert.ok(!short.ok);
		if (!short.ok) assert.match(short.error, /at least 12/);
		assert.ok(!genericProviderKeyGuard("OPENAI_API_KEY", "has whitespace now").ok);
		assert.ok(!genericProviderKeyGuard("OPENAI_API_KEY", "   ").ok);
	});

	it("trims before checking", () => {
		assert.ok(genericProviderKeyGuard("OPENROUTER_API_KEY", "  sk-or-v1-xyz999  ").ok);
	});
});

describe("maskKey (plaintext never leaves)", () => {
	it("shows the last 4 only", () => {
		assert.equal(maskKey("sk-or-v1-abcdefgh1234"), "…1234");
	});

	it("never reveals a degenerate short value in full", () => {
		assert.equal(maskKey("ab"), "…ab");
		assert.equal(maskKey("abcd"), "…abcd");
		assert.equal(maskKey("abcde"), "…bcde");
	});

	it("trims before masking", () => {
		assert.equal(maskKey("  sk-or-v1-xyzw9  "), "…yzw9");
	});
});
