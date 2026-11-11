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

## Herramienta para comentarios de código

`.traduccion/comentarios.cjs` (requiere el paquete `typescript`):

```bash
npm i --prefix /tmp/tsdep typescript@5
export TS_PATH=/tmp/tsdep/node_modules/typescript
# 1) Extraer los comentarios de un lote (o de una parte de él):
node .traduccion/comentarios.cjs extraer /tmp/C1 $(cat .traduccion/lotes/C1.txt)
#    → /tmp/C1.json (posiciones) y /tmp/C1.txt (originales con cabeceras "@@ id ruta:línea")
# 2) Escribir /tmp/C1.es.txt con las mismas cabeceras "@@ id" y el comentario traducido debajo.
#    Se pueden reflujar las líneas // libremente (la herramienta re-sangra); los /* */ y /** */
#    deben conservar su apertura y cierre. Un id ausente se deja sin tocar.
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
| M1 | Raíz, docs generales y prompts del agente (`src/agent/**/*.md`) | 40 | 30.172 | [~] parcial |
| M2 | Docs de plugins (`docs/plugin-*.md`, flashcards) y READMEs de `plugins/` y `examples/` | 20 | 34.368 | [ ] |
| M3 | `docs/plugin-api/` | 22 | 31.155 | [ ] |
| M4 | `docs/archive/`, `skills/` y READMEs de `tests/` | 14 | 26.742 | [ ] |
| C1 | Comentarios: `src/core/contracts`, `src/store`, `src/server/pi`, `src/agent` (sin subagents) | 86 | 28.518 | [ ] |
| C2 | Comentarios: `src/agent/subagents`, `src/server` | 59 | 30.924 | [ ] |
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

Antes de dar por cerrado un lote, busca enlaces rotos a anclas en inglés:
`grep -rnoE '\]\([^)#]*\.md#[a-z0-9-]+\)' --include=*.md .` y compáralos con los encabezados reales.

## Registro

- Sesión 1: rama creada, herramienta probada, plan y lotes generados. Comentarios de
  `components/dock-height.ts` y `components/ui/button.tsx` traducidos.
  M1 hecho: AGENTS.md, CONTRIBUTING.md, README.md, SECURITY.md, docs/README.md,
  docs/getting-started.md, docs/development.md, docs/architecture.md, docs/claude-code.md,
  docs/custom-providers.md, docs/themes.md, docs/tool-content-recovery.md.
  M1 pendiente: docs/desktop-release.md, docs/keyboard.md, docs/teaching-methodology.md,
  docs/compaction-accounting.md, docs/dialog-overlay-contract.md y todo `src/agent/**/*.md`.
