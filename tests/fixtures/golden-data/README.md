# Datos de referencia: datos reales de usuario, leídos por las rutas de producción

**La norma (decisión del propietario, 2026-10-10):** este directorio es un directorio de
datos REAL: registros literales escritos por el código real de la aplicación, nunca
editados a mano. Cualquier cambio intencionado del formato en disco actualiza estos datos
EN EL MISMO COMMIT; un cambio no intencionado hace fallar `tests/golden-fixtures.test.ts`.
Cuando lleguen las marcas de versión del esquema (oleada D), el commit que las ponga
actualizará estos ficheros con él.

`tests/golden-fixtures.test.ts` copia este directorio a uno temporal, apunta allí los
almacenes de producción mediante la costura `LH_DATA_DIR` y lo lee TODO por las rutas de
lectura reales: registros de chat (los pliegues del contrato + el aplanado de la
comunicación con el LLM), libros del grafo (comprobaciones de forma + la derivación
completa), tareas y ajustes. También fija la COBERTURA de marcadores: cada tipo de marcador
personalizado y la superficie de herramientas del núcleo deben aparecer aquí en datos
reales.

## Contenido

- `chats/chat_mv27rrra_feff23b6.json`: la referencia principal de la parte de enseñanza
  (construida por el propietario, 2026-10-10): probe-handoff, plan-block, compaction,
  subagent-steer, subagent-abort y todas las herramientas de enseñanza (quiz,
  ask_user_question, plan_init, probe, probe_done, recall, explain, research, demo, visual,
  pdf, find, grep, ls, read, list_sessions, list_propositions). Árbol del plan + 25
  registros de turnos + una sustitución de modelo por chat.
- `chats/chat_mv293wv5_10656952.json`: el ciclo de vida de la práctica (construido por el
  propietario, 2026-10-10): graph-context (el preámbulo entre corchetes), problem ×2,
  practice-thinking ×2, conclude ×2, practice-next, problem-dismissed; el ciclo completo de
  marcadores de una sesión de práctica, incluido el descarte.
- `graph/`: los libros reales: nodes (282 líneas), chains (160), sessions (8),
  coverage (93), sources (4), render-settings, positions.
- `jobs/`: cinco registros que cubren tipo × estado: research terminada y cancelada por el
  alumno, demo terminada, visual terminada, pdf con error.
- `settings.json`: el registro de ajustes con marca de versión (versión 1, ranuras de
  modelo).

## Regenerar o ampliar

Ejecuta la app (`npm run dev`), ejercita la funcionalidad contra `data/` y copia tal cual
el registro producido. No edites el contenido a mano; si hace falta recortar un registro,
vuelve a ejecutar el flujo.

## Marcas de versión

Estos ficheros tienen deliberadamente la forma heredada SIN MARCA (oleada de marcas de
esquema, 2026-10-10): la v1 perezosa significa que la ausencia se lee como válida
actualmente, así que este conjunto fija para siempre la ruta de lectura anterior a las
marcas. Las escrituras con marca (`version: 1` en los chats, el fichero adjunto
`graph/format.json`) las fija `tests/schema-stamps.test.ts`. Los registros nuevos copiados
después de su primera escritura posterior a las marcas llevarán las marcas; esa forma es
igualmente válida actualmente.
