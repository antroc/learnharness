# Plan de traducción al castellano peninsular

Rama de trabajo: `traduccion-es` (fork `antroc/learnharness`). La rama `main` no se toca.

Alcance: toda la documentación Markdown (96 ficheros, ≈122.000 palabras) y todos los
comentarios del código TS/TSX/JS/MJS/CJS (842 ficheros, ≈247.000 palabras), más los
comentarios y docstrings de los 7 ficheros Python. El código en sí no se modifica.

## Convenciones

- Castellano peninsular, registro técnico neutro, tuteo en instrucciones ("ejecuta", "abre").
- No se traducen: identificadores, nombres de ficheros, rutas, comandos, valores literales,
  nombres de producto (Claude, Electron, Next.js…), ni el contenido de los bloques de código
  de los Markdown (salvo los comentarios dentro de ellos, que sí se traducen).
- Anglicismos asentados se mantienen cuando son más claros que la traducción: *prompt*,
  *plugin*, *frontend*, *backend*, *render*, *scroll*, *viewport*, *overlay*, *dock*, *token*,
  *streaming*, *commit*, *hook*. Glosario mínimo: *learner* → alumno/a; *teacher* → profesor;
  *probe* → sondeo; *practice* → práctica; *side thread/side chat* → hilo lateral;
  *job* → tarea; *worker* → worker; *steer* → reorientación; *compaction* → compactación;
  *session* → sesión; *turn* → turno; *question dock* → dock de preguntas.
- Encabezados Markdown: se traducen y se actualizan los enlaces internos (`#ancla`) que
  apunten a ellos, en el mismo fichero y desde otros ficheros ya traducidos.
- Frontmatter YAML: se traducen los valores descriptivos (`description`), no las claves ni `name`.
- Textos legales (LICENSE, avisos de copyright en THIRD-PARTY) se dejan en inglés.
- Los prompts de `src/agent/prompts/` se traducen como el resto (esta rama es para leer;
  ten en cuenta que, si se ejecutara la app desde esta rama, el agente recibiría los prompts en castellano).
  Consecuencia conocida: las pruebas que comprueban frases literales de los prompts en inglés
  (p. ej. `tests/practice-agents.test.ts`) fallan en esta rama; no se tocan.
- Cadenas literales que el código genera o muestra y que el agente o el lector deben reconocer
  tal cual se dejan en inglés, entre comillas: en los prompts, “Recorded learner–helper
  conversation”, *Your thinking*, *Next problem*, "Check your understanding", "dismissed",
  "was aborted", `<lesson>`. Las etiquetas de la interfaz del host en los docs se traducen
  (Ajustes → Plugins de la comunidad, Potente/Barato/Visión…); los textos de botones que
  define el propio plugin de ejemplo (**Say hello**, **New conversation**…) y los nombres de
  plugins se dejan en inglés.
- THIRD-PARTY: se traduce la prosa explicativa; nombres de licencias, titulares de copyright
  y textos de licencia se dejan en inglés.
- Textos que muestra el host y que los docs citan como literales (mensajes de error y
  diálogos: `Could not prepare submission…`, `Surface target is no longer active`,
  `Submitted image`, `Preparing question…`, `Dictation is active elsewhere`,
  `No settings available`, **Dismiss this question?**…) se dejan en inglés; los botones
  nativos citados en prosa se traducen (Enviar, Detener, Descartar, Reintentar, Reasignar,
  Borrar, Restablecer). Las etiquetas definidas por los plugins oficiales (Draw, Pen, Hand,
  Create card, Review selected, Again/Hard/Good/Easy, Tests passed, ajustes como
  "Dark mode ink color"…) se dejan en inglés. Home / New Draft → Inicio / Nuevo borrador.
- Referencia generada `docs/plugin-api/` (M3): los encabezados son identificadores y no se
  traducen (así las ~1.500 anclas internas no cambian); solo se traduce la prosa (JSDoc).
  Las frases repetidas ya están traducidas en los 22 ficheros con `sed` (sesión 3):
  "Tipo público del SDK, exportado como…", "Declaración de apoyo usada por un tipo
  público…", "— declaración de apoyo", "**Tipos relacionados:**", "**Devuelve:**",
  "**Índice de miembros** (…)", "[Índice de la API]", los enlaces a guías de la cabecera y
  el comentario `<!-- Generado por … -->`. Consecuencia conocida: la prueba
  `tests/plugin-api-reference.test.ts` (que compara con una regeneración) falla en esta
  rama; no se toca. También se tradujeron en todos los ficheros "— N firmas o variantes" y
  las cabeceras de las tablas de parámetros ("| Parámetro | Tipo |"). Excepción: los
  encabezados de `docs/plugin-api/README.md` sí se tradujeron (nada enlaza a sus anclas).
  Para la prosa se usa `.traduccion/prosa.py` (extrae los párrafos fuera de código y
  encabezados, agrupa los repetidos y aplica la traducción por id, como `comentarios.cjs`).

## Herramienta para comentarios de código

`.traduccion/comentarios.cjs` (requiere el paquete `typescript`):

```bash
npm i --prefix /tmp/tsdep typescript@5
export TS_PATH=/tmp/tsdep/node_modules/typescript
# 1) Extraer los comentarios de un lote (o de una parte de él):
node .traduccion/comentarios.cjs extraer /tmp/C1 $(cat .traduccion/lotes/C1.txt)
#    → /tmp/C1.json (posiciones) y /tmp/C1.txt (originales con cabeceras "@@ id ruta:línea")
# 2) Escribir /tmp/C1.es.txt con las mismas cabeceras "@@ id" y el comentario traducido debajo.
#    Cada grupo de líneas // debe conservar EXACTAMENTE su número de líneas (la herramienta
#    re-sangra, pero los saltos entre comentarios // cuentan como código y, si cambian, no
#    escribe el fichero); dentro de cada línea se puede redistribuir el texto. Los /* */ y
#    /** */ pueden cambiar de número de líneas, pero deben conservar su apertura y cierre.
#    Las directivas como /* turbopackIgnore: true */ se omiten (id ausente = sin tocar).
# 3) Aplicar:
node .traduccion/comentarios.cjs aplicar /tmp/C1
```

`aplicar` solo escribe un fichero si su código sin comentarios queda idéntico (según el
parser de TypeScript); si algo falla lo indica por id y no toca ese fichero. Las directivas
(`eslint-disable`, `@ts-expect-error`, `/// <reference>`, etc.) se excluyen al extraer.

Para lotes grandes conviene extraer por tandas de 10–20 ficheros (por ejemplo con
`sed -n '1,15p' .traduccion/lotes/C1.txt`), traducir, aplicar y hacer commit de cada tanda.

## Lotes y estado

Marca `[x]` al terminar cada lote y anota en "Registro" lo que quede a medias.

| Lote | Contenido | Ficheros | Palabras | Estado |
|------|-----------|---------:|---------:|--------|
| M1 | Raíz, docs generales y prompts del agente (`src/agent/**/*.md`) | 40 | 30.172 | [x] |
| M2 | Docs de plugins (`docs/plugin-*.md`, flashcards) y READMEs de `plugins/` y `examples/` | 20 | 34.368 | [x] |
| M3 | `docs/plugin-api/` | 22 | 31.155 | [x] |
| M4 | `docs/archive/`, `skills/` y READMEs de `tests/` | 14 | 26.742 | [x] |
| C1 | Comentarios: `src/core/contracts`, `src/store`, `src/server/pi`, `src/agent` (sin subagents) | 86 | 28.518 | [x] |
| C2 | Comentarios: `src/agent/subagents`, `src/server` | 59 | 30.924 | [~] parcial |
| C3 | Comentarios: `src/core` (1ª mitad) | 38 | 21.353 | [ ] |
| C4 | Comentarios: `src/core` (2ª mitad) | 30 | 21.060 | [ ] |
| C5 | Comentarios: `components/*` raíz (1ª mitad) | 37 | 32.633 | [ ] |
| C6 | Comentarios: `components/*` raíz (2ª mitad) | 89 | 31.871 | [ ] |
| C7 | Comentarios: `components/{settings,artifacts,ui,ai-elements}`, `app`, `electron`, `scripts`, `plugins`, configuración | 201 | 33.875 | [ ] |
| C8 | Comentarios: `tests/` (1ª mitad) | 124 | 23.181 | [ ] |
| C9 | Comentarios: `tests/` (2ª mitad) + los 7 `.py` (a mano) | 178 | 23.180 | [ ] |

Las listas exactas de ficheros están en `.traduccion/lotes/<lote>.txt`.
`components/dock-height.ts` y `components/ui/button.tsx` ya están hechos (prueba de la herramienta)
y no figuran en ningún lote.

## Anclas traducidas (para mantener los enlaces entre ficheros)

Al traducir un fichero enlazado desde otro, usa estos encabezados (o actualiza esta tabla y
los enlaces entrantes si decides otro). Formato de ancla de GitHub: minúsculas, espacios → `-`,
se quitan los signos de puntuación y se conservan las tildes.

| Fichero | Original | Traducido |
|---|---|---|
| docs/README.md | `#about-these-docs` | `#sobre-esta-documentación` |
| docs/architecture.md | `#code-boundaries` | `#límites-del-código` |
| docs/architecture.md | `#teaching-and-practice` | `#enseñanza-y-práctica` (enlazado desde un README de `plugins/`, lote M2) |
| docs/architecture.md | `#storage-and-notifications` | `#almacenamiento-y-notificaciones` |
| docs/architecture.md | `#file-access-and-external-services` | `#acceso-a-ficheros-y-servicios-externos` |
| docs/architecture.md | `#trusted-local-plugins-api-v1` | `#plugins-locales-de-confianza-api-v1` |
| docs/development.md | `#checks` | `#comprobaciones` |
| docs/plugin-architecture.md (M2) | `#inference-persistent-work-and-recovery` | `#inferencia-trabajo-persistente-y-recuperación` (ya enlazado así) |
| docs/plugin-architecture.md (M2) | `#submission-preparation-images-and-view-snapshots` | `#preparación-de-envíos-imágenes-e-instantáneas-de-vista` (ya enlazado así) |
| docs/plugin-architecture.md (M2) | `#testing` | `#pruebas` |
| docs/plugin-authoring.md (M2) | `#package-and-installation` | `#empaquetado-e-instalación` (ya enlazado así) |
| docs/plugin-authoring.md (M2) | `#controlled-host-ui` | `#interfaz-controlada-del-host` (ya enlazado así) |
| docs/plugin-authoring.md (M2) | `#action-shortcuts` | `#atajos-de-acciones` (enlaces entrantes ya actualizados) |
| docs/plugin-authoring.md (M2) | `#quick-start` | `#inicio-rápido` |
| docs/plugin-authoring.md (M2) | `#install-a-prebuilt-package` | `#instalar-un-paquete-precompilado` |
| docs/plugin-authoring.md (M2) | `#develop-outside-the-plugins-directory` | `#desarrollar-fuera-del-directorio-de-plugins` (ya enlazado así desde skills/learnharness-plugins/SKILL.md) |
| docs/plugin-authoring.md (M2) | `#backend-and-data` | `#backend-y-datos` (ya enlazado así desde docs/plugin-api/) |
| docs/plugin-authoring.md (M2) | `#managed-conversational-agents` | `#agentes-conversacionales-gestionados` (ídem) |
| docs/plugin-authoring.md (M2) | `#result-oriented-workers-and-background-tools` | `#workers-orientados-a-resultados-y-herramientas-en-segundo-plano` (ídem) |
| docs/plugin-session-extension-contract.md (M2) | `#8-public-surface-contract` | `#8-contrato-público-de-superficies` (enlaces entrantes ya actualizados) |
| docs/plugin-api/README.md (M3) | `#entry-points`, `#modules`, `#public-types`, `#supporting-declarations`, `#external-types` | `#puntos-de-entrada`, `#módulos`, `#tipos-públicos`, `#declaraciones-de-apoyo`, `#tipos-externos` (sin enlaces entrantes) |
| docs/plugin-examples.md (M2) | `#focused-recipes-for-gaps` | `#recetas-centradas-para-los-huecos` |
| plugins/ui-showcase/README.md (M2) | `#gallery-map` | `#mapa-de-la-galería` (ya enlazado así desde docs/plugin-examples.md) |

Antes de dar por cerrado un lote, busca enlaces rotos a anclas en inglés:
`grep -rnoE '\]\([^)#]*\.md#[a-z0-9-]+\)' --include=*.md .` y compáralos con los encabezados reales.
Más fiable: `python3 .traduccion/anclas.py .` comprueba todos los enlaces `fichero.md#ancla`
contra los encabezados reales (los 4 avisos de URL externas de docs/claude-code.md son
falsos positivos).

## Registro

- Sesión 1: rama creada, herramienta probada, plan y lotes generados. Comentarios de
  `components/dock-height.ts` y `components/ui/button.tsx` traducidos.
  M1 hecho: AGENTS.md, CONTRIBUTING.md, README.md, SECURITY.md, docs/README.md,
  docs/getting-started.md, docs/development.md, docs/architecture.md, docs/claude-code.md,
  docs/custom-providers.md, docs/themes.md, docs/tool-content-recovery.md.
  M1 pendiente: docs/desktop-release.md, docs/keyboard.md, docs/teaching-methodology.md,
  docs/compaction-accounting.md, docs/dialog-overlay-contract.md y todo `src/agent/**/*.md`.
- Sesión 2: M1 terminado: docs/desktop-release.md, docs/keyboard.md,
  docs/teaching-methodology.md, docs/compaction-accounting.md (la licencia MIT del final se
  deja en inglés), docs/dialog-overlay-contract.md y los 28 .md de `src/agent/` (system-prompt,
  prompts/README y los fragmentos de prober, practice, shared, side-chat y teacher).
  M2 hecho: examples/plugins/{hello-plugin,managed-agent,teaching-extension}/README.md,
  docs/flashcards-implementation-plan.md, plugins/drawing-pad/THIRD-PARTY.md,
  plugins/rich-code-blocks/THIRD-PARTY.md, docs/plugin-view-context.md.
  M2 pendiente: docs/flashcards-vision.md, docs/plugin-architecture.md,
  docs/plugin-authoring.md, docs/plugin-examples.md, docs/plugin-problem-contract.md,
  docs/plugin-question-contract.md, docs/plugin-session-extension-contract.md,
  docs/plugin-tree-contract.md, plugins/{coding-questions,drawing-pad,flashcards,
  rich-code-blocks,ui-showcase}/README.md.
- Sesión 3: M2 terminado: docs/plugin-architecture.md, docs/plugin-authoring.md,
  docs/plugin-session-extension-contract.md, docs/plugin-problem-contract.md,
  docs/plugin-question-contract.md, docs/plugin-tree-contract.md, docs/plugin-examples.md,
  docs/flashcards-vision.md y los README de plugins/{ui-showcase,drawing-pad,
  rich-code-blocks,coding-questions,flashcards}. Enlaces entrantes a las anclas nuevas
  actualizados en todo el repo (también en docs/plugin-api/ y skills/, aún sin traducir).
  Comprobación de anclas: sin enlaces rotos.
  M3 empezado: frases repetidas traducidas en los 22 ficheros (ver Convenciones) y prosa
  completa de docs/plugin-api/{phases,plugin-shortcuts,contracts-jobs,settings}.md.
  M3 pendiente (prosa JSDoc): README.md, contracts-chat, contracts-graph, contracts-models,
  contracts-plan, events, native-messages, plugin-agents, plugin-problems,
  plugin-questions, plugin-submissions, plugin-tree, plugin-ui, plugin-view-context,
  plugin-workers, plugins, question-core, view.
- Sesión 4: M3 terminado: prosa de los 18 ficheros pendientes de docs/plugin-api/ con
  la herramienta nueva `.traduccion/prosa.py`; README.md con encabezados traducidos (nada
  enlazaba a sus anclas); "— N firmas o variantes" y "| Parámetro | Tipo |" traducidos en
  todos los ficheros. Las teclas se dejan en inglés (Enter, Shift+Enter, Ctrl+Enter), como
  en docs/keyboard.md. Comprobación de anclas: sin enlaces rotos (solo los 4 falsos
  positivos conocidos).
  M4 empezado: docs/archive/README.md, docs/archive/release-0.3.md,
  skills/learnharness-plugins/README.md, tests/skills/README.md,
  tests/fixtures/golden-data/README.md (ninguno tenía enlaces entrantes a sus anclas).
  M4 pendiente: skills/learnharness-plugins/SKILL.md, skills/learnharness/SKILL.md,
  skills/learnharness/references/data-format.md, docs/archive/{probe-teach-split,plan,
  architecture-2026-09-08,pi-engine-swap,vision,plugin-implementation-history}.md.
- Sesión 5: M4 terminado: skills/learnharness-plugins/SKILL.md, skills/learnharness/SKILL.md
  (en el frontmatter solo se traduce `description`; `compatibility` y `license` se dejan en
  inglés), skills/learnharness/references/data-format.md (las descripciones del bloque
  `text` del mapa de ficheros se tradujeron como comentarios) y docs/archive/{plan,
  probe-teach-split,architecture-2026-09-08,pi-engine-swap,vision,
  plugin-implementation-history}.md. Ninguno tenía enlaces entrantes a sus anclas (los
  `plan.md#…` de docs/plugin-api/ son de contracts-plan.md); los "destinos históricos"
  `fichero.md#ancla` de plugin-implementation-history.md son texto en `código` y se dejan
  igual. En architecture-2026-09-08.md el diagrama de capas se tradujo y se volvió a alinear.
  Consecuencia conocida: `tests/skills/test_skill.py` busca las frases en inglés
  "Never modify LearnHarness's data" y "archival view" en skills/learnharness/SKILL.md y
  falla en esta rama; no se toca. Comprobación de anclas: sin enlaces rotos (solo los 4
  falsos positivos conocidos).
  C1 empezado: comentarios de las líneas 1–32 de `.traduccion/lotes/C1.txt` (de
  src/agent/background-capture.ts a src/agent/side-chat.ts), en dos tandas.
  C1 pendiente: líneas 33–86 de `.traduccion/lotes/C1.txt` (desde src/agent/subscription-bridge.ts).
- Sesión 6: C1 terminado: líneas 33–86 de `.traduccion/lotes/C1.txt` (de
  src/agent/subscription-bridge.ts a src/store/themes.ts) en cuatro tandas con su commit.
  Las directivas `/* turbopackIgnore: true */` se dejaron sin tocar. La frase literal
  "a problem is already active" (mensaje de la herramienta) se deja en inglés en
  src/agent/tools/practice.ts. Glosario añadido en la práctica: *seam* → frontera;
  *gate* → barrera; *owner* → responsable; *wave* → oleada; *ledger* → registro;
  *steer* (mensaje) → reorientación; *wake* → despertar; *handoff* → traspaso;
  *prober* → sondeador; *merger* → fusionador; *heal* → reparación; *chunk* → fragmento.
  C2 empezado: líneas 1–4 de `.traduccion/lotes/C2.txt` (src/agent/subagents/aborts.ts,
  annotation-svg.ts, demo-builder.ts, extraction.ts).
  C2 pendiente: líneas 5–59 de `.traduccion/lotes/C2.txt` (desde
  src/agent/subagents/headless.ts). Ficheros grandes: headless.ts (≈1.500 palabras),
  runner.ts (≈1.300), src/server/chat-handler.ts (≈3.300), src/server/jobs.ts (≈2.900),
  compaction.ts, keys.ts y model-catalog.ts (≈1.100–1.250 cada uno).
