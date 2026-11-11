# phases

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [Phase3](#phase3) — declaración de apoyo

## Phase3

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Fases de una sesión de enseñanza derivadas en orden a partir de los eventos de la
transcripción, no de la ocupación del árbol del plan ni de un indicador explícito de
aceptación del plan:

- probe: hasta que probe_done tiene un resultado de herramienta correcto.
- plan: tras completar el sondeo, hasta una llamada a una pregunta de enseñanza etiquetada
  con un nodo.
- teach: desde esa primera llamada en adelante, sin esperar a su respuesta.

Las llamadas nativas de quiz/explain y las anotaciones admitidas de preguntas de enseñanza
de plugins aportan el límite de la enseñanza. Los resúmenes de registros nativos y los
divisores de la vista proyectada usan los mismos límites de eventos; presentar un plan por
sí solo no hace avanzar la fase mostrada a teach.

Las tres fases de una sesión, tal como las ven el selector, la cabecera y los divisores.

```ts
export type Phase3 = "probe" | "plan" | "teach";
```
