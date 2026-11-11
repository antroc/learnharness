"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { PluginComposerProps, PluginDictationProps, PluginStandardComposerProps } from "@/src/core";
import { Composer } from "@/components/composer";
import type { Dictation } from "@/components/dictation";
import { claimPluginInputFocus, PluginDictationControl, usePluginDictation } from "@/components/plugin-dictation";
import { PluginModelPicker, PluginThinkingPicker, type PickerCommand } from "@/components/plugin-model-picker";

/** Los callbacks diferidos de la transcripción pueden ser asíncronos; el envío debe esperar todas las entregas. */
export function createTranscriptDelivery() {
	const pending = new Set<Promise<void>>();
	let failure: { error: unknown } | null = null;
	return {
		append(deliver: () => void | Promise<void>, onError: (error: unknown) => void) {
			let task: Promise<void>;
			failure = null;
			try { task = Promise.resolve(deliver()); }
			catch (error) { task = Promise.reject(error); }
			pending.add(task);
			// Observa/informa sin sustituir la promesa devuelta al motor:
			// Dictation.finish debe esperarla y rechazar si la entrega falla.
			void task.then(() => pending.delete(task), (error: unknown) => {
				failure = { error }; pending.delete(task); onError(error);
			});
			return task;
		},
		async finish(finish: () => Promise<void>, send: () => void | Promise<void>) {
			await finish();
			while (pending.size) await Promise.all([...pending]);
			if (failure) { const error = failure.error; failure = null; throw error; }
			await send();
		},
	};
}

type Extra = { onError?: (error: unknown) => void; signal?: AbortSignal };
function useAbortDictation(signal: AbortSignal | undefined, cancel: () => void) {
	useEffect(() => {
		if (signal?.aborted) { cancel(); return; }
		signal?.addEventListener("abort", cancel, { once: true });
		return () => signal?.removeEventListener("abort", cancel);
	}, [signal, cancel]);
}
const reportDefault = (error: unknown) => console.error("Plugin UI callback failed", error);
function run(callback: () => void | Promise<void>, report: (error: unknown) => void) {
	try { void Promise.resolve(callback()).catch(report); } catch (error) { report(error); }
}

/** El composer exacto del núcleo, con sus valores por defecto de aprendizaje/ficheros desactivados explícitamente. */
export function PluginComposer({ value, onChange, onSend, busy = false, onStop, canSend, placeholder = "Message…", autoFocus, onError = reportDefault }: PluginComposerProps & Extra) {
	return <Composer value={value} onChange={(next) => run(() => onChange(next), onError)} onSend={() => run(onSend, onError)}
		onStop={() => run(() => onStop?.(), onError)} busy={busy} canSend={canSend ?? value.trim().length > 0}
		placeholder={placeholder} autoFocus={autoFocus} defaultDropTarget={false} fileInsertion={false} />;
}

export function PluginDictation({ onTranscript, disabled, onError = reportDefault, actionRef, signal }: PluginDictationProps & Extra & { actionRef?: RefObject<Dictation | null> }) {
	const root = useRef<HTMLDivElement>(null);
	const latest = useRef(onTranscript);
	latest.current = onTranscript;
	const delivery = useRef(createTranscriptDelivery());
	const dictation = usePluginDictation({ append: (text) => delivery.current.append(() => latest.current(text), onError), disabled });
	useAbortDictation(signal, dictation.cancel);
	useEffect(() => {
		if (actionRef) actionRef.current = dictation;
		const off = root.current ? claimPluginInputFocus(root.current, { toggleDictation: dictation.toggle }) : undefined;
		return () => { off?.(); if (actionRef) actionRef.current = null; };
	});
	return <div ref={root} tabIndex={-1}><PluginDictationControl dictation={dictation} disabled={disabled} /></div>;
}

export function PluginStandardComposer({ composer, model, thinking, dictation: dictationProps, onError = reportDefault, signal }: PluginStandardComposerProps & Extra) {
	const root = useRef<HTMLDivElement>(null);
	const latest = useRef({ composer, dictationProps });
	latest.current = { composer, dictationProps };
	const delivery = useRef(createTranscriptDelivery());
	const modelCommand = useRef<PickerCommand | null>(null);
	const thinkingCommand = useRef<PickerCommand | null>(null);
	const dictation = usePluginDictation({
		disabled: dictationProps.disabled,
		append: (text) => delivery.current.append(() => latest.current.dictationProps.onTranscript(text), onError),
	});
	useAbortDictation(signal, dictation.cancel);
	useEffect(() => {
		if (!root.current) return;
		return claimPluginInputFocus(root.current, {
			toggleDictation: dictation.toggle,
			cycleModel: () => modelCommand.current?.invoke(),
			cycleThinking: () => thinkingCommand.current?.invoke(),
		});
	});
	return <div ref={root} data-plugin-standard-composer="">
		<div className="overflow-hidden rounded-2xl border bg-card shadow-lg">
			<PluginComposer {...composer} canSend={composer.canSend ?? (composer.value.trim().length > 0 || dictation.active)}
				onSend={async () => { await dictation.finish(); await latest.current.composer.onSend(); }} onError={onError} />
		</div>
		{/* Como en el dock nativo, los controles van debajo del armazón solo de texto. */}
		<div className="flex items-center gap-1.5 px-3 pt-2 font-ui text-xs text-muted-foreground">
			<PluginDictationControl dictation={dictation} disabled={dictationProps.disabled} />
			<PluginModelPicker {...model} commandRef={modelCommand} onError={onError} />
			<PluginThinkingPicker {...thinking} commandRef={thinkingCommand} onError={onError} />
		</div>
	</div>;
}
