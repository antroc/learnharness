"use client";

import { createContext } from "react";
import type { JobRecord } from "@/src/core";

/**
 * Canal de observabilidad de las tareas en segundo plano (contracts.ts "THE
 * ASYNC PROTOCOL" §4).
 *
 * UNA lectura central (en Chat) lee GET /api/jobs?chatId=… y publica aquí la
 * lista — al montar, con cada anuncio de jobs-changed (el almacén emite tras
 * escribir) y al resincronizar el canal (arquitectura push S4, 2026-10-02);
 * todas las superficies de tareas la consumen — las tarjetas de despacho de la
 * transcripción (la caja del acuse con el estado vivo) y el panel de
 * subagentes de la barra lateral. Antes, cada tarjeta ejecutaba su propio
 * sondeador sobre las partes input-available; con el protocolo de acuse la
 * parte de la herramienta se resuelve de inmediato, así que la lectura pasó a
 * la raíz de composición y las tarjetas se convirtieron en renderizadores puros
 * de estos datos.
 */
export const JobsContext = createContext<JobRecord[]>([]);
