"use client";

import { useState } from "react";
import { ConfidenceRail } from "@/components/confidence-rail";
import { GlyphMark } from "@/components/ui/glyph-mark";
import { StatusBadge } from "@/components/ui/status-badge";
import { SubmittedImages } from "./submitted-images";
import { ThinkingBlock } from "@/components/thinking-block";
import { PathText } from "@/components/file-path-chip";
import { cn } from "@/lib/utils";
import { ToolContentResponse } from "@/components/ai-elements/message";
import type { QuestionAnswerData } from "@/src/core";
import { answerForPresentation, parseAskInput, parseQuizInput } from "@/src/core";

/**
 * Renderizado estático de una pregunta respondida (parte de herramienta en `output-available`).
 *
 * Las respuestas de quiz se CORRIGEN: marcas ✓/✗, las respuestas correctas y la
 * explicación. Las respuestas de ask NO se corrigen — un simple registro de lo dicho.
 * (El fallo de v1 que esto fija: las respuestas de ask nunca deben recibir la
 * interfaz de corrección del quiz.) Las respuestas de explain las corrige el MODELO
 * en su siguiente respuesta, no el cliente — la tarjeta revela la respuesta del
 * alumno, la respuesta correcta comprometida y la explicación, SIN chips de
 * veredicto (decisión del responsable 2026-09-27).
 */
export function AnsweredCard({ answer: savedAnswer, input }: { answer: QuestionAnswerData; input?: unknown }) {
	const answer = answerForPresentation(savedAnswer, input);
	const [whyOpen, setWhyOpen] = useState(false); // la explicación recogida (predicciones, responsable 2026-10-03)
	if (answer.dismissed) {
		return (
			<div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
				<span className="font-medium">{answer.questionText}</span> — skipped
			</div>
		);
	}

	const isQuiz = answer.kind === "quiz";
	const isExplain = answer.kind === "explain";
	const selectedIdx = new Set(answer.answers.map((a) => a.index));
	const correctIdx = new Set(answer.correctIndices ?? []);
	// El contexto propio de la pregunta viaja en la LLAMADA ORIGINAL, no en la instantánea
	// de la respuesta (responsable, 2026-10-12): la línea de detalles — y, en las preguntas
	// ask, las descripciones de las opciones — se vuelven a renderizar a partir de los
	// argumentos persistidos, así que todas las transcripciones existentes también los
	// muestran. La instantánea ligera (lo que ve el modelo, compactAnswerForModel) no se toca;
	// cualquier fallo de análisis o entrada ausente renderiza exactamente la tarjeta anterior.
	const askInput = answer.kind === "ask" ? parseAskInput(input) : undefined;
	const parsedDetails = askInput?.details ?? (answer.kind === "quiz" ? parseQuizInput(input)?.details : undefined);
	const descByIndex = new Map((askInput?.options ?? []).map((o, i) => [i + 1, o.description]));

	return (
		<>
		{/* El canal de lectura ELEVADO (ronda del responsable, 2026-10-05): los pensamientos
		    capturados durante la lectura son cronológicamente ANTERIORES a la pregunta —
		    se renderizan como un bloque propio del lado del usuario ENCIMA de la tarjeta, el
		    ThinkingBlock unificado, en lugar de un recuadro dentro de la respuesta. El mismo
		    raíl atenuado de antes; la etiqueta ahora es simplemente "Your thinking". */}
		{(answer.readingThinking || answer.images?.readingThinking?.length) && (
			<ThinkingBlock testId="reading-thinking-block" label="YOUR THINKING" text={answer.readingThinking ?? ""} images={answer.images?.readingThinking} defaultOpen />
		)}
		{/* [&>*:last-child]:mb-0 (ronda del responsable, 2026-10-07): en las tarjetas de ask
		    la fila de razonamiento es el último hijo — su my-3 se apilaba con el p-4 de la
		    tarjeta en un hueco de 28px por debajo (12px por encima); el propio relleno de la
		    tarjeta es el ritmo inferior cuando una fila cierra la tarjeta. */}
		<div
			className="rounded-xl border bg-card p-4 text-card-foreground [&>*:last-child]:mb-0"
			data-testid="answered-card"
		>
			<div className="mb-1 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
				{/* Primero el nombre PROPIO de la herramienta (responsable 2026-10-09): las tarjetas
			    de la fase de sondeo se rotulan Probe/Recall — el límite entre fases se ve en la
			    transcripción. Sin `tool` en los registros antiguos: etiquetas por tipo, como antes. */}
				{answer.tool === "probe"
					? "Probe"
					: answer.tool === "recall"
						? "Recall"
						: isQuiz
								? answer.questionType === "predict"
									? "Prediction"
									: "Check"
									: isExplain
										? "Explain"
											: "Question"}
				{isQuiz &&
					(answer.dontKnow ? (
						<StatusBadge text="didn't know" />
					) : answer.correct ? (
						<StatusBadge text="correct" color="var(--lh-success)" />
					) : (
						<StatusBadge text="incorrect" color="var(--lh-error)" />
					))}
			</div>
			<div className="mb-3 font-medium">
				<ToolContentResponse>{answer.questionText}</ToolContentResponse>
			</div>
			{parsedDetails && (
				// La línea de detalles, con el mismo pintado que el dock pendiente (responsable,
				// 2026-10-12): markdown completo, LaTeX incluido.
				<div className="mb-3 text-sm text-muted-foreground">
					<ToolContentResponse>{parsedDetails}</ToolContentResponse>
				</div>
			)}

			{((answer.options?.length ?? 0) > 0 || answer.other) && (
				<div className="flex flex-col gap-1.5 text-sm">
					{answer.options?.map((opt) => {
						const sel = selectedIdx.has(opt.index);
						const key = isQuiz && correctIdx.has(opt.index);
						return (
							<div
								key={opt.index}
								className={cn(
									"flex items-center gap-2 rounded-lg border px-3 py-1.5",
									sel && key && "border-success/60 bg-success/10",
									sel && !key && isQuiz && "border-error/60 bg-error/10",
									sel && !isQuiz && "border-primary bg-accent",
									!sel && key && "border-success/40",
								)}
							>
								{isQuiz && (
									// Contornos SVG derivados de Zapf Dingbats — las formas exactas dibujadas a mano de
									// LaTeX \ding{51}/\ding{55} (responsable, ronda 6); ver ui/glyph-mark.
									<span
										aria-hidden
										data-mark={sel && key ? "check" : sel && !key ? "x" : !sel && key ? "check" : undefined}
										className={cn(
											"flex shrink-0 items-center",
											sel && key && "text-success",
											sel && !key && "text-error",
											!sel && key && "text-success",
										)}
									>
										{/* Ronda 8 del responsable: un pelín más pequeño que el texto (size-4→size-3.5,
											   ≈14px frente a la fila de 16px) y centrado. */}
										{(key || sel) && <GlyphMark kind={key ? "check" : "x"} className="size-3.5" />}
									</span>
								)}
								<span className={cn(!sel && "text-muted-foreground")}>
									<ToolContentResponse>{opt.label}</ToolContentResponse>
									{descByIndex.get(opt.index) && (
										// Subtexto de las opciones de ask (responsable, 2026-10-12): la misma ruta de markdown
										// que el dock pendiente — LaTeX incluido. Las opciones del quiz no llevan
										// (decisión del responsable 2026-09-26); para ellas el mapa queda vacío.
										<ToolContentResponse className="lh-prose block text-xs text-muted-foreground">
											{descByIndex.get(opt.index)}
										</ToolContentResponse>
									)}
								</span>
							</div>
						);
					})}
					{/* La opción escrita por el propio alumno es una OPCIÓN — el mismo contenedor, el
					    mismo estilo de seleccionada que sus hermanas, no una cita suelta flotando fuera
					    de la lista. Las comillas conservan las palabras del alumno. */}
					{answer.other && (
						<div
							data-testid="answered-other"
							className="flex items-center gap-2 rounded-lg border border-primary bg-accent px-3 py-1.5"
						>
							<span>“<PathText text={answer.other} />”</span>
						</div>
					)}
				</div>
			)}

			{answer.text && <div className="lh-prose mt-2 whitespace-pre-wrap">“<PathText text={answer.text} />”</div>}
			<SubmittedImages images={answer.images?.answer} />

			{/* El registro de la confianza (ronda 6 del responsable): el raíl del deslizador, sin
			    el disco — la propia falta del tirador dice "esto es un registro, no un control".
			    El mismo pintado, las mismas marcas, la misma rampa y la misma lectura en % que el
			    dock en vivo. Solo en respuestas de quiz, y solo si existe una confianza: "I don't
			    know" no la envió (su deslizador estaba atenuado), explain y ask nunca la tuvieron,
			    y los registros anteriores a la función no llevan el campo — nada que mostrar, nada
			    renderizado. */}
			{isQuiz && answer.confidence != null && (
				<div className="mt-3 flex items-center gap-3" data-testid="answered-confidence">
					<ConfidenceRail value={answer.confidence} className="min-w-0 flex-1" />
					<span className="w-9 shrink-0 text-right font-mono text-sm tabular-nums text-muted-foreground">
						{answer.confidence}%
					</span>
				</div>
			)}
			{answer.dontKnow && isQuiz && (
				<div className="mt-2 text-sm text-muted-foreground">Answered “I don't know”.</div>
			)}

			{((answer.thinking ?? answer.note) || answer.images?.thinking?.length) && (
				/* La MISMA fila unificada (ronda del responsable, 2026-10-05): el razonamiento de la
				    respuesta del quiz es el idéntico ThinkingBlock plegable — una sola geometría, pero
				    SIN banda en la tarjeta (quinta ronda del responsable, 2026-10-07: el realce del
				    acento se veía demasiado claro); solo el raíl, alturas idénticas. */
				<ThinkingBlock
					testId="your-thinking"
					label="YOUR THINKING"
					text={answer.thinking ?? answer.note ?? ""}
					images={answer.images?.thinking}
					inCard
				/>
			)}

			{/* px-3→eliminado: el p-4 de la tarjeta + el px-3 de la caja metían dos veces el
			    margen y dejaban la etiqueta "Why" más adentro que los bordes de las cajas de las
			    opciones (responsable, ronda 3). Laterales alineados con todo lo demás; py-2 se
			    queda para el aire vertical. */}
			{isQuiz && answer.explanation && (
				/* La explicación RECOGIDA — TODAS las preguntas (responsable, 2026-10-07): el
				   veredicto se muestra y la explicación queda plegada tras el conmutador Why —
				   visible, pero nunca en primer plano. Idéntico al patrón de las predicciones que
				   generaliza (responsable, 2026-10-03). */
				<div className="mt-2" data-testid="tucked-explanation">
					<button
						type="button"
						onClick={() => setWhyOpen((v) => !v)}
						className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
					>
						{whyOpen ? "Hide why" : "Why"}
					</button>
					{whyOpen && (
						<div className="mt-1.5 rounded-lg bg-muted py-2 text-sm text-foreground/50">
							<span className="font-medium text-muted-foreground">Why: </span>
							{/* Se mantiene el primer párrafo junto a la etiqueta, no todos los párrafos:
							   los párrafos posteriores deben conservar su estructura de documento recuperada. */}
							<ToolContentResponse className="inline [&>p:first-child]:inline [&>p:first-child]:m-0">{answer.explanation}</ToolContentResponse>
						</div>
					)}
				</div>
			)}

			{/* La revelación de explain (decisión del responsable 2026-09-27): la respuesta
			    comprometida — un solo campo, razonamiento incluido — se muestra al enviar; sin
			    veredicto, la siguiente respuesta del modelo ES la corrección. */}
			{isExplain && answer.committed && (
				<div className="mt-3 rounded-lg bg-muted py-2 text-sm text-muted-foreground">
					<span className="font-medium text-foreground">The answer: </span>
					<ToolContentResponse className="inline [&>p:first-child]:inline [&>p:first-child]:m-0">{answer.committed}</ToolContentResponse>
				</div>
			)}
		</div>
		</>
	);
}
