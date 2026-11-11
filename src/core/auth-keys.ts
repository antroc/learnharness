/**
 * El catálogo curado de claves de autenticación + las reglas de forma (oleada
 * auth-keys, 2026-09-19). PURO y seguro en el navegador: sin fs ni entorno. El
 * catálogo alimenta la lista de claves de la página de autenticación
 * (etiqueta, descripción, enlace a la documentación de dónde conseguirla) y la
 * validación de forma al escribir (decisión del responsable: validación SOLO
 * DE FORMA, sin comprobaciones en vivo; una clave revocada parece correcta
 * hasta que falla una llamada real; se eligió ese compromiso antes que llamar
 * a los proveedores).
 *
 * El almacén en sí es el mapa plano {VAR: value} de auth.json de siempre (ver
 * config.AUTH_FILE): las claves se identifican POR el nombre de su variable de
 * entorno, el mismo nombre que leen hoy los consumidores (OPENROUTER_API_KEY,
 * …), así que el id del catálogo ES la clave del fichero y la variable de
 * entorno: un solo nombre en todas partes.
 *
 * Las variables desconocidas del fichero (fuera del catálogo) se CONSERVAN tal
 * cual y se muestran como entradas genéricas (compatibilidad hacia delante
 * para entradas futuras, p. ej. un token de inicio de sesión de planes, sin
 * cambiar el esquema), pero no se pueden escribir a mano mediante la API
 * curada (solo las claves del catálogo tienen formas que merezca la pena
 * comprobar y documentación que merezca la pena mostrar).
 */

/** Una entrada de clave curada. `id` es el nombre de la variable de entorno/clave del fichero. */
export interface AuthKeyInfo {
	id: string;
	/** Etiqueta legible para la página de ajustes. */
	label: string;
	/** Una frase sobre para qué sirve. */
	description: string;
	/** Dónde consigue el usuario una clave (se abre en el navegador real mediante el shell). */
	docsUrl: string;
}

export const AUTH_KEYS: readonly AuthKeyInfo[] = [
	{
		id: "DEEPGRAM_API_KEY",
		label: "Deepgram",
		description: "Speech-to-text key for dictation — needs ≥ Member permission in the Deepgram console to mint tokens.",
		docsUrl: "https://console.deepgram.com/",
	},
	{
		id: "TAVILY_API_KEY",
		label: "Tavily",
		description: "Web-search engine for the researcher sub-agent (AI-native search API). Setting the key activates it — no engine toggle needed.",
		docsUrl: "https://app.tavily.com/",
	},
	{
		id: "BRAVE_API_KEY",
		label: "Brave Search",
		description: "Web-search engine for the researcher sub-agent — the alternative to Tavily. Setting the key activates it.",
		docsUrl: "https://brave.com/search/api/",
	},
	{
		id: "EXA_API_KEY",
		label: "Exa",
		description: "Web-search engine for the researcher. Search requests use your Exa account and its pricing.",
		docsUrl: "https://dashboard.exa.ai/api-keys",
	},
	{
		id: "FIRECRAWL_API_KEY",
		label: "Firecrawl",
		description: "Web-search engine for the researcher sub-agent — an alternative to Tavily and Brave. Setting the key activates it.",
		docsUrl: "https://www.firecrawl.dev/app/api-keys",
	},
	{
		id: "OLLAMA_API_KEY",
		label: "Ollama",
		description: "Hosted web search at ollama.com — requires an Ollama API key. Setting it activates search, not local models.",
		docsUrl: "https://ollama.com/settings/keys",
	},
] as const;

const AUTH_KEY_IDS: ReadonlySet<string> = new Set(AUTH_KEYS.map((k) => k.id));

export function isKnownAuthKey(id: string): boolean {
	return AUTH_KEY_IDS.has(id);
}

/** Una fila de clave de proveedor de modelos para el desplegable de la página
 *  de ajustes: qué proveedor de pi-ai, la variable de entorno en la que va su
 *  clave y la etiqueta legible (el propio Provider.name de pi). */
export interface AuthProviderInfo {
	id: string;
	envVar: string;
	label: string;
}

/**
 * LA TABLA DE CLAVES DE PROVEEDORES DE MODELOS (interludio de claves de
 * proveedor, 2026-09-19): todos los proveedores de pi-ai que usan una variable
 * de entorno de clave API SIMPLE, derivada de la propia tabla
 * proveedor→variable de pi-ai al generarla, así que nunca puede desviarse de
 * lo que lee pi de verdad: tests/auth-provider-keys.test.ts vuelve a derivar
 * la verdad desde pi-ai (builtinProviders + findEnvKeys con un entorno proxy
 * que da valor a todas las variables) y comprueba la igualdad EXACTA con esta
 * tabla; una actualización de pi-ai que añada o renombre una clave de
 * proveedor hace fallar la barrera con estruendo en lugar de desviarse en
 * silencio.
 *
 * EXCLUIDOS por especificación del responsable: los proveedores cuya
 * autenticación no es una clave simple en esta oleada: github-copilot (OAuth),
 * amazon-bedrock (credenciales de AWS), google-vertex (ADC), azure (necesita
 * una URL base) y el par de cloudflare con ámbito de cuenta. Anthropic
 * mantiene solo ANTHROPIC_API_KEY; sus alternativas AUTH_TOKEN/OAUTH_TOKEN se
 * quedan solo en el entorno. openai-codex no expone clave de entorno (ausente
 * de forma natural). Los proveedores que comparten una variable de entorno
 * (moonshotai / moonshotai-cn, opencode / opencode-go, el par
 * qwen-token-plan, las variantes de xiaomi) mantienen cada uno su propia
 * fila; la interfaz los agrupa como quiera.
 */
export const AUTH_PROVIDER_KEYS: readonly AuthProviderInfo[] = [
	{ id: "ant-ling", envVar: "ANT_LING_API_KEY", label: "Ant Ling" },
	{ id: "anthropic", envVar: "ANTHROPIC_API_KEY", label: "Anthropic" },
	{ id: "baseten", envVar: "BASETEN_API_KEY", label: "Baseten" },
	{ id: "cerebras", envVar: "CEREBRAS_API_KEY", label: "Cerebras" },
	{ id: "deepseek", envVar: "DEEPSEEK_API_KEY", label: "DeepSeek" },
	{ id: "fireworks", envVar: "FIREWORKS_API_KEY", label: "Fireworks" },
	{ id: "google", envVar: "GEMINI_API_KEY", label: "Google" },
	{ id: "groq", envVar: "GROQ_API_KEY", label: "Groq" },
	{ id: "huggingface", envVar: "HF_TOKEN", label: "Hugging Face" },
	{ id: "kimi-coding", envVar: "KIMI_API_KEY", label: "Kimi For Coding" },
	{ id: "meta", envVar: "META_API_KEY", label: "Meta" },
	{ id: "minimax", envVar: "MINIMAX_API_KEY", label: "MiniMax" },
	{ id: "minimax-cn", envVar: "MINIMAX_CN_API_KEY", label: "MiniMax CN" },
	{ id: "mistral", envVar: "MISTRAL_API_KEY", label: "Mistral" },
	{ id: "moonshotai", envVar: "MOONSHOT_API_KEY", label: "Moonshot AI" },
	{ id: "moonshotai-cn", envVar: "MOONSHOT_API_KEY", label: "Moonshot AI CN" },
	{ id: "nvidia", envVar: "NVIDIA_API_KEY", label: "NVIDIA" },
	{ id: "openai", envVar: "OPENAI_API_KEY", label: "OpenAI" },
	{ id: "opencode", envVar: "OPENCODE_API_KEY", label: "OpenCode Zen" },
	{ id: "opencode-go", envVar: "OPENCODE_API_KEY", label: "OpenCode Go" },
	{ id: "openrouter", envVar: "OPENROUTER_API_KEY", label: "OpenRouter" },
	{ id: "qwen-token-plan", envVar: "QWEN_TOKEN_PLAN_API_KEY", label: "Qwen Token Plan" },
	{ id: "qwen-token-plan-cn", envVar: "QWEN_TOKEN_PLAN_CN_API_KEY", label: "Qwen Token Plan CN" },
	{ id: "qwen-token-plan-individual", envVar: "QWEN_TOKEN_PLAN_API_KEY", label: "Qwen Token Plan Individual" },
	{ id: "radius", envVar: "RADIUS_API_KEY", label: "Radius" },
	{ id: "together", envVar: "TOGETHER_API_KEY", label: "Together" },
	{ id: "typesafe", envVar: "TYPESAFE_API_KEY", label: "TypeSafe" },
	{ id: "vercel-ai-gateway", envVar: "AI_GATEWAY_API_KEY", label: "Vercel AI Gateway" },
	{ id: "xai", envVar: "XAI_API_KEY", label: "xAI" },
	{ id: "xiaomi", envVar: "XIAOMI_API_KEY", label: "Xiaomi" },
	{ id: "xiaomi-token-plan-ams", envVar: "XIAOMI_TOKEN_PLAN_AMS_API_KEY", label: "Xiaomi Token Plan AMS" },
	{ id: "xiaomi-token-plan-cn", envVar: "XIAOMI_TOKEN_PLAN_CN_API_KEY", label: "Xiaomi Token Plan CN" },
	{ id: "xiaomi-token-plan-sgp", envVar: "XIAOMI_TOKEN_PLAN_SGP_API_KEY", label: "Xiaomi Token Plan SGP" },
	{ id: "zai", envVar: "ZAI_API_KEY", label: "Z.AI" },
	{ id: "zai-coding-cn", envVar: "ZAI_CODING_CN_API_KEY", label: "Z.AI Coding CN" },
] as const;

/**
 * La identidad del ÚNICO endpoint personalizado: un servidor compatible con
 * OpenAI configurado por el usuario y registrado en pi-ai en ejecución
 * (server/custom-provider.ts). NO forma parte de AUTH_PROVIDER_KEYS (esa tabla
 * está fijada por las pruebas a los proveedores integrados de pi-ai y se
 * indexa por variable de entorno); este se indexa por una URL base que aporta
 * el usuario, y su clave va en esta variable de entorno reservada (opcional:
 * se permiten servidores locales sin clave).
 */
export const CUSTOM_PROVIDER = {
	id: "custom",
	envVar: "CUSTOM_OPENAI_API_KEY",
	label: "Custom endpoint",
} as const;

/** Todas las variables de entorno distintas en las que va una clave de
 *  proveedor de modelos (la comprobación de escritura; ver isProviderEnvVar
 *  más abajo; también decide qué variables de proveedor PRESENTES aparecen
 *  como filas de estado). */
export const AUTH_PROVIDER_ENV_VARS: ReadonlySet<string> = new Set(AUTH_PROVIDER_KEYS.map((p) => p.envVar));

/** ¿Es este nombre de variable de entorno la clave de ALGÚN proveedor de modelos de pi-ai? */
export function isProviderEnvVar(envVar: string): boolean {
	return AUTH_PROVIDER_ENV_VARS.has(envVar);
}

/** Resultado de la comprobación de forma: ok, o un mensaje listo para un 400 que dice lo esperado. */
export type KeyShapeResult = { ok: true } | { ok: false; error: string };

/**
 * La barrera de forma al escribir (decisión del responsable: rechazar con 400
 * los pegados incorrectos; una clave truncada o de otra familia nunca puede
 * llegar al almacén). Los valores primero se RECORTAN (higiene del pegado);
 * quedarse vacío tras recortar siempre falla.
 *
 * Las claves CURADAS llevan reglas de familia (los prefijos tvly-… de Tavily y
 * fc-… de Firecrawl; Brave, Exa, Ollama y Deepgram solo usan longitud mínima +
 * higiene del pegado). Las claves de PROVEEDORES DE MODELOS usan en su lugar
 * genericProviderKeyGuard, más abajo (las familias varían según el proveedor;
 * solo se aplica la higiene del pegado; especificación del responsable:
 * longitud mínima ~12, sin espacios). OPENROUTER_API_KEY pasó a la protección
 * genérica con el interludio de claves de proveedor; ya no se comprueba la
 * familia sk-or.
 */
export function validateKeyShape(id: string, rawValue: string): KeyShapeResult {
	const value = rawValue.trim();
	const nonEmpty = (min: number) =>
		value.length >= min && !/\s/.test(value)
			? { ok: true as const }
			: { ok: false as const, error: `${id} must be at least ${min} characters with no whitespace` };
	switch (id) {
		case "TAVILY_API_KEY":
			return value.startsWith("tvly-")
				? nonEmpty(20)
				: { ok: false, error: `${id} must start with "tvly-" (Tavily's key format)` };
		case "BRAVE_API_KEY":
			// Sin formato público: solo una longitud mínima + higiene del pegado.
			return nonEmpty(20);
		case "EXA_API_KEY":
		case "OLLAMA_API_KEY":
			// Sin prefijo de clave documentado: se usa la protección de pegado de las claves de proveedor.
			return nonEmpty(12);
		case "FIRECRAWL_API_KEY":
			return value.startsWith("fc-")
				? nonEmpty(20)
				: { ok: false, error: `${id} must start with "fc-" (Firecrawl's key format)` };
		case "DEEPGRAM_API_KEY":
			// Sin formato público: la longitud mínima solo detecta pegados truncados.
			return nonEmpty(20);
		default:
			return { ok: false, error: `unknown key "${id}" (supported: ${[...AUTH_KEY_IDS].join(", ")})` };
	}
}

/** La protección genérica contra truncados para las claves de PROVEEDORES DE
 *  MODELOS (las familias varían; solo se aplica la higiene del pegado;
 *  especificación del responsable: recortar, sin espacios, mínimo 12). */
export function genericProviderKeyGuard(id: string, rawValue: string): KeyShapeResult {
	const value = rawValue.trim();
	if (value.length >= 12 && !/\s/.test(value)) return { ok: true };
	return { ok: false, error: `${id} must be at least 12 characters with no whitespace` };
}

/** Una clave enmascarada nunca sale del servidor en claro (decisión del
 *  responsable: los últimos 4 caracteres + la longitud; suficiente para
 *  identificar qué clave está guardada tras rotar entre varias y para detectar
 *  un pegado de la familia equivocada). */
export function maskKey(value: string): string {
	const v = value.trim();
	if (v.length <= 4) return `…${v}`; // pegado degenerado: aun así, nunca el valor entero
	return `…${v.slice(-4)}`;
}

/** La fila de estado de una clave para la vista del GET (nunca lleva texto en claro). */
export interface AuthKeyStatus {
	id: string;
	/** Metadatos del catálogo si la clave está curada; null para las entradas de
	 *  variables desconocidas del fichero (se conservan y se muestran, pero sin
	 *  formulario curado con el que editarlas). */
	info: AuthKeyInfo | null;
	/** Una clave está presente si la tiene el entorno O el fichero. */
	present: boolean;
	/** Final enmascarado normal + recuento, p. ej. "…ab12 (64 chars)"; las claves
	 * personalizadas se ocultan por completo, sin caracteres de la credencial sea cual sea su longitud. */
	masked: string | null;
	/** De dónde sale el valor vivo, con la precedencia de que gana el entorno. */
	source: "env" | "file" | "none";
	/** True cuando el fichero tiene un valor que el entorno tapa; la página de
	 *  ajustes explica por qué una clave guardada no es la que está en uso. */
	shadowedByEnv: boolean;
}
