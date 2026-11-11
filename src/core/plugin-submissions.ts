/** Contratos de envíos del alumno seguros para el navegador y límites de preparación inmutables. */
import type { ImageContent } from "@earendil-works/pi-ai";
import type { LhMessage } from "./native-messages.ts";
import type { PluginQuestionOccurrence, PluginQuestionSnapshot } from "./plugin-questions.ts";
import type { PluginProblemSnapshot } from "./plugin-problems.ts";
import type { AnswerRequest, ClientQuestion, QuestionData, QuizQuestionType } from "./question-core.ts";
import { clonePluginQuestionJson } from "./plugin-questions.ts";
import type { PluginSurfaceTarget } from "./plugin-ui.ts";

type Immutable<T> = T extends (...args: never[]) => unknown ? T : T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;
type ImmutableJson = null | boolean | number | string | ImmutableJsonArray | ImmutableJsonObject;
interface ImmutableJsonArray extends ReadonlyArray<ImmutableJson> {}
interface ImmutableJsonObject { readonly [key: string]: ImmutableJson }

/** Aparición exacta de la herramienta nativa, nunca un mero ID de llamada a herramienta que podría reutilizarse. */
export type PluginSubmissionOccurrence = Readonly<PluginQuestionOccurrence>;
export type PluginSubmissionChannel = "content" | "answer" | "submission" | "thinking" | "readingThinking";
export interface PluginSubmissionContent {
	readonly text: string;
	readonly images: readonly Readonly<ImageContent>[];
}
/** Canales de imagen nativos opcionales junto a las autoridades textuales existentes. */
export interface PluginSubmissionImages {
	readonly answer?: readonly Readonly<ImageContent>[];
	readonly thinking?: readonly Readonly<ImageContent>[];
	readonly readingThinking?: readonly Readonly<ImageContent>[];
}
export interface PluginProblemSubmissionImages {
	readonly submission?: readonly Readonly<ImageContent>[];
	readonly thinking?: readonly Readonly<ImageContent>[];
}
export interface PluginBuiltinSubmissionAnswer {
	readonly dontKnow?: boolean;
	readonly values?: readonly string[];
	readonly other?: string;
	readonly text?: string;
	readonly confidence?: number;
	readonly images: readonly Readonly<ImageContent>[];
}
export type PluginSubmission =
	| { readonly type: "text"; readonly content: PluginSubmissionContent }
	| { readonly type: "thinking"; readonly content: PluginSubmissionContent }
	| { readonly type: "answer"; readonly answer: PluginBuiltinSubmissionAnswer; readonly thinking: PluginSubmissionContent; readonly readingThinking: PluginSubmissionContent }
	| { readonly type: "plugin-problem-submission"; readonly submission: ImmutableJson; readonly submissionImages: readonly Readonly<ImageContent>[]; readonly thinking: PluginSubmissionContent }
	| { readonly type: "plugin-question-answer"; readonly answer: ImmutableJson; readonly answerImages: readonly Readonly<ImageContent>[]; readonly thinking: PluginSubmissionContent; readonly readingThinking: PluginSubmissionContent };

type SubmissionTargetBase = {
	readonly sessionId: string;
	readonly sessionKind: "teaching" | "practice";
	readonly surfaceTarget: PluginSurfaceTarget;
};
export type PluginSubmissionTarget = SubmissionTargetBase & (
	| { readonly type: "text"; readonly channels: readonly ["content"] }
	| { readonly type: "thinking"; readonly channels: readonly ["content"]; readonly problem: { readonly occurrence: PluginSubmissionOccurrence; readonly statement: string } }
	| { readonly type: "answer"; readonly channels: readonly PluginSubmissionChannel[]; readonly question: Immutable<ClientQuestion & { occurrence: PluginSubmissionOccurrence; questionType?: QuizQuestionType }> }
	| { readonly type: "plugin-problem-submission"; readonly channels: readonly ["submission", "thinking"]; readonly problem: Immutable<Pick<PluginProblemSnapshot, "problemId" | "pluginId" | "typeId" | "contractVersion" | "label"> & { occurrence: PluginSubmissionOccurrence; statement: string }> }
	| { readonly type: "plugin-question-answer"; readonly channels: readonly PluginSubmissionChannel[]; readonly question: Immutable<Pick<PluginQuestionSnapshot, "questionId" | "occurrence" | "pluginId" | "typeId" | "contractVersion" | "label" | "variant" | "showThinking">> }
);
export type PluginSubmissionContext = PluginSubmissionTarget & {
	/** Historial actual del navegador desvinculado, incluido el contenido que pueda llegar en streaming. */
	readonly messages: readonly Immutable<LhMessage>[];
	readonly signal: AbortSignal;
	/** Notificación de acuse en vivo y sin garantías; no es un evento duradero. */
	onAccepted(callback: () => void | Promise<void>): void;
};
export interface PluginSubmissionInterceptor {
	id: string;
	priority?: number;
	hasPendingInput?(target: PluginSubmissionTarget): boolean;
	intercept(input: PluginSubmission, context: PluginSubmissionContext): PluginSubmission | null | void | Promise<PluginSubmission | null | void>;
}

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const imageMimeTypes = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const base64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function object(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("Submission must contain objects");
	return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = allowed): void {
	if (Object.keys(value).some(key => !allowed.includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw new Error("Unexpected or missing submission fields");
}
function freeze<T>(value: T): T {
	if (value !== null && typeof value === "object") {
		for (const child of Object.values(value)) freeze(child);
		Object.freeze(value);
	}
	return value;
}
function content(value: unknown): PluginSubmissionContent {
	const item = object(value);
	keys(item, ["text", "images"]);
	if (typeof item.text !== "string") throw new Error("Submission text must be a string");
	return { text: item.text, images: imageList(item.images) };
}
/** Solo validación estructural en el navegador. El análisis/normalización de bytes corresponde a la admisión en el servidor. */
export function preparePluginSubmissionImage(value: unknown): Readonly<ImageContent> {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["type", "data", "mimeType"]);
	if (item.type !== "image" || typeof item.mimeType !== "string" || !imageMimeTypes.has(item.mimeType) || typeof item.data !== "string" || !item.data.length || !base64.test(item.data)) throw new Error("Submission images require PNG, JPEG, WebP or GIF native base64 image blocks");
	// Los bits de relleno deben ser cero; aceptar la entrada truncada de un decodificador permisivo
	// ocultaría una salida mal formada del plugin en lugar de validar base64 nativo.
	if ((item.data.endsWith("==") && (alphabet.indexOf(item.data.at(-3)!) & 15) !== 0) || (item.data.endsWith("=") && !item.data.endsWith("==") && (alphabet.indexOf(item.data.at(-2)!) & 3) !== 0)) throw new Error("Submission image data must be canonical base64");
	return Object.freeze({ type: "image", data: item.data, mimeType: item.mimeType });
}
function imageList(value: unknown): readonly Readonly<ImageContent>[] {
	if (!Array.isArray(value)) throw new Error("Submission images must be an array");
	return value.map(preparePluginSubmissionImage);
}
/** Array de transporte desvinculado; solo validación estructural, y sigue siendo necesario el procesamiento de bytes en el servidor. */
export function validatePluginSubmissionImageArray(value: unknown): ImageContent[] {
	return imageList(clonePluginQuestionJson(value)).map(image => ({ ...image }));
}
export function validatePluginSubmissionImages(value: unknown): PluginSubmissionImages {
	return preparePluginSubmissionImages(value);
}
/** Valida los canales de transporte opcionales y omite los arrays de imágenes vacíos al escribir. */
export function preparePluginSubmissionImages(value: unknown): PluginSubmissionImages {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["answer", "thinking", "readingThinking"], []);
	const result: Record<string, readonly Readonly<ImageContent>[]> = {};
	for (const key of ["answer", "thinking", "readingThinking"] as const) {
		if (!Object.hasOwn(item, key)) continue;
		const images = imageList(item[key]);
		if (images.length) result[key] = images;
	}
	return freeze(result);
}
export function preparePluginProblemSubmissionImages(value: unknown): PluginProblemSubmissionImages {
	const item = object(clonePluginQuestionJson(value));
	keys(item, ["submission", "thinking"], []);
	const result: Record<string, readonly Readonly<ImageContent>[]> = {};
	for (const key of ["submission", "thinking"] as const) if (Object.hasOwn(item, key)) {
		const images = imageList(item[key]);
		if (images.length) result[key] = images;
	}
	return freeze(result);
}
function builtinAnswer(value: unknown): PluginBuiltinSubmissionAnswer {
	const item = object(value);
	keys(item, ["dontKnow", "values", "other", "text", "confidence", "images"], ["images"]);
	if (Object.hasOwn(item, "dontKnow") && typeof item.dontKnow !== "boolean") throw new Error("dontKnow must be boolean");
	if (Object.hasOwn(item, "values") && (!Array.isArray(item.values) || item.values.some(value => typeof value !== "string"))) throw new Error("Answer values must be strings");
	for (const key of ["other", "text"] as const) if (Object.hasOwn(item, key) && typeof item[key] !== "string") throw new Error(`Answer ${key} must be a string`);
	if (Object.hasOwn(item, "confidence") && (typeof item.confidence !== "number" || !Number.isFinite(item.confidence))) throw new Error("Answer confidence must be finite");
	return { ...item, images: imageList(item.images) } as unknown as PluginBuiltinSubmissionAnswer;
}
function nonempty(value: PluginSubmissionContent): boolean { return !!value.text.trim() || value.images.length > 0; }
/** Desvincula y congela estrictamente la salida de cada hook; la identidad nunca puede devolverse como entrada. */
export function preparePluginSubmission(input: unknown, target: PluginSubmissionTarget): PluginSubmission {
	const item = object(clonePluginQuestionJson(input));
	if (item.type !== target.type) throw new Error("Submission type cannot change");
	if (item.type === "text" || item.type === "thinking") {
		keys(item, ["type", "content"]);
		return freeze({ type: item.type, content: content(item.content) });
	}
	if (item.type === "plugin-problem-submission") {
		keys(item, ["type", "submission", "submissionImages", "thinking"]);
		return freeze({ type: "plugin-problem-submission", submission: item.submission as ImmutableJson, submissionImages: imageList(item.submissionImages), thinking: content(item.thinking) });
	}
	keys(item, item.type === "answer" ? ["type", "answer", "thinking", "readingThinking"] : ["type", "answer", "answerImages", "thinking", "readingThinking"]);
	const thinking = content(item.thinking), readingThinking = content(item.readingThinking);
	const channels: readonly PluginSubmissionChannel[] = target.channels;
	if ((!channels.includes("thinking") && nonempty(thinking)) || (!channels.includes("readingThinking") && nonempty(readingThinking))) throw new Error("Submission channel is not applicable");
	if (item.type === "answer") return freeze({ type: "answer", answer: builtinAnswer(item.answer), thinking, readingThinking });
	return freeze({ type: "plugin-question-answer", answer: item.answer as ImmutableJson, answerImages: imageList(item.answerImages), thinking, readingThinking });
}

/** Valida los campos en bruto contra la pregunta privada mostrada; buildAnswer sigue siendo el único calificador. */
export function validatePluginBuiltinSubmissionAnswer(question: QuestionData, answer: PluginBuiltinSubmissionAnswer): AnswerRequest {
	const raw = builtinAnswer(object(clonePluginQuestionJson(answer)));
	const values = raw.values ?? [], other = raw.other?.trim() ?? "", text = raw.text?.trim() ?? "";
	if (new Set(values).size !== values.length || values.some(value => !question.options.some(option => option.value === value))) throw new Error("Answer contains duplicate or unknown option values");
	if (raw.confidence !== undefined && question.kind !== "quiz") throw new Error("Confidence is only applicable to quiz answers");
	if (question.mode === "text") {
		if (values.length || other || raw.dontKnow === true) throw new Error("Selection fields are not applicable to text answers");
		if (!text && !raw.images.length) throw new Error("Answer text or answer images are required");
	} else {
		if (text || (other && question.kind !== "ask")) throw new Error("Answer field is not applicable to this question");
		if (raw.dontKnow && (values.length || other)) throw new Error("dontKnow cannot be combined with an answer selection");
		if (question.mode === "single-select" && values.length + (other ? 1 : 0) > 1) throw new Error("A single-select answer requires one selection");
		if (!raw.dontKnow && !values.length && !other) throw new Error("An answer selection is required");
	}
	// Se conserva la confianza finita incluso con dontKnow: buildAnswer la descarta ahí a
	// propósito, y es dueño del redondeo/acotado en las selecciones reales de cuestionario.
	return {
		...(raw.dontKnow !== undefined ? { dontKnow: raw.dontKnow } : {}),
		...(raw.values !== undefined ? { values: [...raw.values] } : {}),
		...(raw.other !== undefined ? { other: raw.other } : {}),
		...(raw.text !== undefined ? { text: raw.text } : {}),
		...(raw.confidence !== undefined ? { confidence: raw.confidence } : {}),
	};
}

/** Captura los callbacks validados y la prioridad sin congelar una definición propiedad del plugin. */
export function preparePluginSubmissionInterceptor(definition: PluginSubmissionInterceptor): Readonly<PluginSubmissionInterceptor> {
	const item = object(definition);
	if (typeof item.id !== "string" || !identifier.test(item.id)) throw new Error("Invalid submission interceptor id");
	if (item.priority !== undefined && (typeof item.priority !== "number" || !Number.isFinite(item.priority) || !Number.isInteger(item.priority))) throw new Error("Submission interceptor priority must be a finite integer");
	if (typeof item.intercept !== "function" || (item.hasPendingInput !== undefined && typeof item.hasPendingInput !== "function")) throw new Error("Invalid submission interceptor callbacks");
	return Object.freeze({ id: definition.id, priority: definition.priority ?? 0, intercept: definition.intercept, ...(definition.hasPendingInput ? { hasPendingInput: definition.hasPendingInput } : {}) });
}
export function comparePluginSubmissionInterceptors(left: { pluginId: string; definition: PluginSubmissionInterceptor }, right: { pluginId: string; definition: PluginSubmissionInterceptor }): number {
	const priority = (right.definition.priority ?? 0) - (left.definition.priority ?? 0);
	if (priority) return priority;
	const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
	return compare(left.pluginId, right.pluginId) || compare(left.definition.id, right.definition.id);
}
/** Conserva la referencia opaca del host; nunca clona ni congela el propio token de destino. */
export function copyPluginSubmissionTarget(target: PluginSubmissionTarget): PluginSubmissionTarget {
	const { surfaceTarget, ...data } = target;
	const copy = freeze(structuredClone(data));
	return Object.freeze({ ...copy, surfaceTarget }) as PluginSubmissionTarget;
}
/** El historial nativo actual es propiedad del host y puede contener campos undefined explícitos. */
export function copyPluginSubmissionHistory(messages: readonly LhMessage[]): PluginSubmissionContext["messages"] {
	return freeze(structuredClone(messages)) as unknown as PluginSubmissionContext["messages"];
}
