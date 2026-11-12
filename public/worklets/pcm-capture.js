/*
 * pcm-capture — la vía de audio del dictado (oleada de STT, 2026-09-17).
 *
 * Se ejecuta FUERA del hilo principal (AudioWorklet): convierte las muestras
 * Float32 del micrófono a PCM de 16 bits little-endian (linear16) y pasa los
 * búferes al hilo principal en dos streams:
 *
 *   { type: "level", rms }  — en cada cuanto de render (128 muestras ≈ 8ms a
 *                             16kHz): el nivel RMS del cuanto, 0..1. Es el
 *                             latido del medidor; enviar por cada cuanto es
 *                             lo que hace que el medidor parezca instantáneo
 *                             (la latencia dominante en la versión de
 *                             terminal del responsable era un búfer de E/S
 *                             de 256ms; ver ~/.pi/agent/extensions/dictate).
 *   { type: "audio", buffer } — tramas Int16Array de 2048 muestras (128ms),
 *                             sin copia (transferidas). Deepgram recomienda
 *                             fragmentos de ~100–200ms; también se envía el
 *                             silencio, así que el socket nunca queda
 *                             inactivo (no hace falta KeepAlive: el plazo de
 *                             10 s de NET-0001 solo afecta a un stream que
 *                             deja de ENVIAR).
 *
 * Se distribuye como fichero estático bajo public/ para que viaje en el
 * paquete standalone. JS simple por necesidad (los worklets se ejecutan
 * fuera del grafo de módulos).
 */
class PcmCaptureProcessor extends AudioWorkletProcessor {
	constructor() {
		super();
		this.frame = new Int16Array(2048);
		this.count = 0;
	}

	process(inputs) {
		const channel = inputs[0] && inputs[0][0];
		if (!channel) return true; // aún no hay entrada; sigue vivo

		// RMS para el medidor (dominio float, antes de la conversión).
		let sumSquares = 0;
		for (let i = 0; i < channel.length; i++) sumSquares += channel[i] * channel[i];
		this.port.postMessage({ type: "level", rms: Math.sqrt(sumSquares / channel.length) });

		// Float32 → Int16 (acotando primero: un micrófono muy alto puede superar ±1.0).
		for (let i = 0; i < channel.length; i++) {
			const s = Math.max(-1, Math.min(1, channel[i]));
			this.frame[this.count++] = s < 0 ? s * 0x8000 : s * 0x7fff;
			if (this.count === this.frame.length) {
				this.port.postMessage({ type: "audio", buffer: this.frame }, [this.frame.buffer]);
				this.frame = new Int16Array(2048);
				this.count = 0;
			}
		}
		return true;
	}
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
