# contracts-graph

<!-- Generado por scripts/build-plugin-api-reference.mjs. Edita los contratos y guías canónicos, no esta página. -->

[Índice de la API](README.md) · [Acceso a datos y límites del host](../plugin-authoring.md#backend-y-datos)

- [Cluster](#cluster) — declaración de apoyo
- [CoverageEntry](#coverageentry)
- [EmissionStats](#emissionstats) — declaración de apoyo
- [GraphChain](#graphchain)
- [GraphEdge](#graphedge) — declaración de apoyo
- [GraphNode](#graphnode)
- [GraphSnapshot](#graphsnapshot)
- [NotesSource](#notessource)
- [Position](#position)
- [ProvenancePoint](#provenancepoint) — declaración de apoyo
- [SessionCheckpoint](#sessioncheckpoint)

## Cluster

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Clúster renderizado en una instantánea del grafo. Los miembros son IDs de nodos de proposición;
la geometría de la envolvente se deriva de sus posiciones al renderizar.

```ts
export interface Cluster {
    id: string;
    label: string | null;
    members: string[];
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#cluster-id)
- [label](#cluster-label)
- [members](#cluster-members)

### Cluster id

El id del registro de etiquetado cuando se ha reclamado; los clústeres sin etiqueta siguen
apareciendo (envolvente, sin nombre) con un id hash de sus miembros.

```ts
id: string;
```

### Cluster label

null hasta que la llamada de nombrado ha acuñado/reclamado un etiquetado.

```ts
label: string | null;
```

### Cluster members

Ids de nodo, ordenados. La envolvente + el centroide son asunto del renderizador.

```ts
members: string[];
```

## CoverageEntry

Tipo público del SDK, exportado como `CoverageEntry`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Entrada de coverage.jsonl que marca un mensaje extraído por la huella de su vista de
extracción. El contenido sin cubrir se deriva comparando las huellas actuales;
una respuesta que cambia la vista de una pregunta solo reabre ese mensaje. La extracción
de chats registra la cobertura de mensajes; las importaciones de notas usan puntos de control de la fuente.

```ts
export interface CoverageEntry {
    chatId: string;
    fp: string;
    tokens: number;
    foldedAt: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#coverageentry-chatid)
- [fp](#coverageentry-fp)
- [tokens](#coverageentry-tokens)
- [foldedAt](#coverageentry-foldedat)

### CoverageEntry chatId

```ts
chatId: string;
```

### CoverageEntry fp

sha256 de las líneas de la vista del mensaje: «cubierto» significa exactamente esto.

```ts
fp: string;
```

### CoverageEntry tokens

Estimación caracteres/4 de la vista del mensaje: visualización + presupuesto.

```ts
tokens: number;
```

### CoverageEntry foldedAt

ISO: cuándo se fusionó la última ejecución de extracción de este mensaje.

```ts
foldedAt: string;
```

## EmissionStats

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Recuentos fusionados en los registros del grafo por una ejecución de extracción, guardados también con
el uso de la extracción. Los registros de uso antiguos pueden omitir las cadenas y llevar en su lugar
recuentos de aristas; las fusiones actuales escriben recuentos de cadenas.

```ts
export interface EmissionStats {
    nodes: number;
    chains?: number;
    droppedChains?: number;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [nodes](#emissionstats-nodes)
- [chains](#emissionstats-chains)
- [droppedChains](#emissionstats-droppedchains)

### EmissionStats nodes

Nodos nuevos del grafo anexados.

```ts
nodes: number;
```

### EmissionStats chains

Cadenas de razonamiento nuevas anexadas.

```ts
chains?: number;
```

### EmissionStats droppedChains

Cadenas eliminadas por simplificación durante esta fusión, aparte de los
anexados nuevos contados en chains. Se omite cuando no se elimina ninguna; los registros sin
este campo aportan cero eliminaciones.

```ts
droppedChains?: number;
```

## GraphChain

Tipo público del SDK, exportado como `GraphChain`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Argumento guardado cuyas premisas implican conjuntamente su conclusión. Los argumentos
independientes siguen siendo cadenas separadas aunque compartan conclusión.
Las cadenas de varias premisas producen un nodo de implicación derivado con el ID arg_
de la cadena; las de una sola premisa se renderizan como flechas directas. Eliminar una
proposición elimina en cascada las cadenas que la referencian.

```ts
export interface GraphChain {
    id: string;
    premises: string[];
    conclusion: string;
    provenance: ProvenancePoint[];
    createdAt: string;
}
```

**Tipos relacionados:** [ProvenancePoint](contracts-graph.md#provenancepoint).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#graphchain-id)
- [premises](#graphchain-premises)
- [conclusion](#graphchain-conclusion)
- [provenance](#graphchain-provenance)
- [createdAt](#graphchain-createdat)

### GraphChain id

"arg_" + algo tipo nanoid (asignado por el store, el patrón de acuñación de nodos).

```ts
id: string;
```

### GraphChain premises

Ids de nodo de las premisas del argumento: al menos una, conjuntamente
suficientes. Locales del extractor en la red; ids de nodo tras la resolución.

```ts
premises: string[];
```

### GraphChain conclusion

El id de nodo que las premisas implican conjuntamente.

```ts
conclusion: string;
```

### GraphChain provenance

Cada punto (chat, mensaje) donde se afirmó este argumento,
unidos entre las líneas de afirmación al leer.

```ts
provenance: ProvenancePoint[];
```

### GraphChain createdAt

```ts
createdAt: string;
```

## GraphEdge

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Relación dirigida derivada de las cadenas de razonamiento guardadas, no un registro
independiente. Las aristas del lienzo conectan una premisa única directamente con su
conclusión, o varias premisas a través de un nodo de implicación derivado.
Las aristas lógicas conectan las premisas proposicionales directamente con las conclusiones.

```ts
export interface GraphEdge {
    from: string;
    to: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [from](#graphedge-from)
- [to](#graphedge-to)

### GraphEdge from

```ts
from: string;
```

### GraphEdge to

```ts
to: string;
```

## GraphNode

Tipo público del SDK, exportado como `GraphNode`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

```ts
export interface GraphNode {
    id: string;
    name: string;
    statement: string;
    aliases: string[];
    createdAt: string;
    provenance: ProvenancePoint[];
}
```

**Tipos relacionados:** [ProvenancePoint](contracts-graph.md#provenancepoint).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#graphnode-id)
- [name](#graphnode-name)
- [statement](#graphnode-statement)
- [aliases](#graphnode-aliases)
- [createdAt](#graphnode-createdat)
- [provenance](#graphnode-provenance)

### GraphNode id

Id opaco y estable, asignado por el store: "n_" + algo tipo nanoid.

```ts
id: string;
```

### GraphNode name

Una etiqueta muy corta para el nodo: un asa compacta como la entrada de un
glosario ("Voluntad de poder", "Teoría del mandato divino"): lo que el grafo
muestra de un vistazo. Solo de presentación: no es única, no es clave de
identidad, nunca es precisa: la precisión la lleva el enunciado. Se fija al
crear (la primera línea la define); un anexado de enlace nunca la cambia.

```ts
name: string;
```

### GraphNode statement

La proposición mínima: un enunciado verdadero y autocontenido, con
precisión plena. El ANCLA DE IDENTIDAD: el auditor reconoce un
reencuentro juzgando contra esto (enlazar o crear), no por
coincidencia de strings. Se muestra en la tarjeta de detalle; la etiqueta del lienzo es el
nombre.

```ts
statement: string;
```

### GraphNode aliases

Formulaciones literales que usaron las sesiones para esta proposición (el rastro de
auditoría de identidad: cómo dijo el mundo lo que dice el nodo).

```ts
aliases: string[];
```

### GraphNode createdAt

```ts
createdAt: string;
```

### GraphNode provenance

Cada punto (chat, mensaje) donde apareció esta proposición.

```ts
provenance: ProvenancePoint[];
```

## GraphSnapshot

Tipo público del SDK, exportado como `GraphSnapshot`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Proyección del grafo que contiene las proposiciones/cadenas guardadas y los datos derivados de
renderizado, disposición y procedencia. Las flechas/uniones derivadas no son argumentos guardados.

```ts
export interface GraphSnapshot {
    nodes: GraphNode[];
    propositions: GraphNode[];
    edges: GraphEdge[];
    logicalEdges: GraphEdge[];
    impLinks: Array<{
        id: string;
        premises: string[];
        conclusion: string;
    }>;
    chains: GraphChain[];
    sessions: Record<string, string>;
    fileSources: Record<string, string>;
    nodeSessions: Record<string, string[]>;
    clusters: Cluster[];
    positions?: Record<string, Position>;
}
```

**Tipos relacionados:** [Cluster](contracts-graph.md#cluster), [GraphChain](contracts-graph.md#graphchain), [GraphEdge](contracts-graph.md#graphedge), [GraphNode](contracts-graph.md#graphnode), [Position](contracts-graph.md#position).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [nodes](#graphsnapshot-nodes)
- [propositions](#graphsnapshot-propositions)
- [edges](#graphsnapshot-edges)
- [logicalEdges](#graphsnapshot-logicaledges)
- [impLinks](#graphsnapshot-implinks)
- [chains](#graphsnapshot-chains)
- [sessions](#graphsnapshot-sessions)
- [fileSources](#graphsnapshot-filesources)
- [nodeSessions](#graphsnapshot-nodesessions)
- [clusters](#graphsnapshot-clusters)
- [positions](#graphsnapshot-positions)

### GraphSnapshot nodes

Nodos del lienzo: proposiciones más nodos de implicación derivados para las cadenas de
varias premisas. Cada nodo de implicación usa el ID de su cadena.

```ts
nodes: GraphNode[];
```

### GraphSnapshot propositions

Solo los nodos de proposición GUARDADOS (sin nodos de implicación derivados):
la verdad guardada, como `chains`: los consumidores que leen el mundo
(la tabla de cadenas) usan esta lista, nunca la imagen del lienzo.

```ts
propositions: GraphNode[];
```

### GraphSnapshot edges

Flechas derivadas del lienzo: premisa → conclusión directa para las cadenas de una
sola premisa, o premisa → nodo de implicación → conclusión para las de varias premisas.
Se reconstruyen a partir de las cadenas, no se guardan por separado.

```ts
edges: GraphEdge[];
```

### GraphSnapshot logicalEdges

Flechas directas premisa → conclusión derivadas, solo sobre IDs de proposición.
Los cálculos de profundidad usan estas en lugar de la geometría de los nodos de implicación.

```ts
logicalEdges: GraphEdge[];
```

### GraphSnapshot impLinks

Vínculo de unión derivado de cada cadena viva de varias premisas. La disposición usa
las filas de premisa/conclusión para colocar su nodo de implicación entre ellas.

```ts
impLinks: Array<{
    id: string;
    premises: string[];
    conclusion: string;
}>;
```

### GraphSnapshot chains

Las cadenas de razonamiento GUARDADAS (fusionadas por (premisas, conclusión) al
leer): la entrada de la tabla de cadenas y de la canalización de práctica: leen
la verdad, nunca el despliegue derivado.

```ts
chains: GraphChain[];
```

### GraphSnapshot sessions

chatId → título, para cada chat que tocó el grafo.

```ts
sessions: Record<string, string>;
```

### GraphSnapshot fileSources

srcId → ruta del fichero, para cada fichero de NOTAS IMPORTADAS que tocó el
grafo (la puerta de entrada agnóstica al formato): una entrada de procedencia estática:
la tarjeta de detalle muestra la ruta como texto plano, no como enlace.

```ts
fileSources: Record<string, string>;
```

### GraphSnapshot nodeSessions

nodeId → chatIds que tocaron el nodo (procedencia navegable con clic).

```ts
nodeSessions: Record<string, string[]>;
```

### GraphSnapshot clusters

Comunidades por sesión de nacimiento (core/session-clusters.ts: cada
proposición se une al clúster de la sesión que la hizo nacer:
procedencia de sesión, sin Louvain, sin embeddings), con MIN_CLUSTER_SIZE
≥ 3 como regla de presentación de la envolvente. Solo proposiciones: los nodos
de implicación nunca se particionan. Derivadas puramente de la procedencia: nunca
dependen de la disposición.

```ts
clusters: Cluster[];
```

### GraphSnapshot positions

Posiciones de reposo de la disposición por id de nodo, cuando existe un registro
de posiciones (lo escribe el settle de core/layout.ts). Ausente en un grafo nuevo:
la vista recurre entonces a su propia pasada puntual de forceAtlas2.

```ts
positions?: Record<string, Position>;
```

## NotesSource

Tipo público del SDK, exportado como `NotesSource`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Fuente de notas importada procesada por la canalización extractor → auditor → fusionador.
La procedencia identifica el fichero en lugar de un mensaje de chat, y la fuente
es dueña de su registro de uso de extracción. Los ID son src_ más un hash determinista de la
ruta del fichero, así que reimportar la misma ruta usa la misma identidad de fuente.

```ts
export interface NotesSource {
    id: string;
    filePath: string;
    importedAt: string;
    contentFp?: string;
    extractions?: ExtractionRunUsage[];
}
```

**Tipos relacionados:** [ExtractionRunUsage](contracts-chat.md#extractionrunusage).

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [id](#notessource-id)
- [filePath](#notessource-filepath)
- [importedAt](#notessource-importedat)
- [contentFp](#notessource-contentfp)
- [extractions](#notessource-extractions)

### NotesSource id

```ts
id: string;
```

### NotesSource filePath

```ts
filePath: string;
```

### NotesSource importedAt

ISO: cuándo se importó este fichero (el foldedAt del punto de control).

```ts
importedAt: string;
```

### NotesSource contentFp

Huella de contenido heredada. Se acepta al leer registros antiguos, pero
se ignora: toda importación explícita de notas procesa el fichero entero. Las importaciones
nuevas no calculan ni escriben este campo. No hace falta migración.

```ts
contentFp?: string;
```

### NotesSource extractions

El registro de uso de la ejecución: la misma disciplina de solo anexado que
ChatRecord.extractions, idempotente por startedAt.

```ts
extractions?: ExtractionRunUsage[];
```

## Position

Tipo público del SDK, exportado como `Position`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

La posición de reposo de un nodo en el espacio de la disposición (el registro de posiciones).

```ts
export interface Position {
    x: number;
    y: number;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [x](#position-x)
- [y](#position-y)

### Position x

```ts
x: number;
```

### Position y

```ts
y: number;
```

## ProvenancePoint

Declaración de apoyo usada por un tipo público. No es una API de runtime adicional ni un helper del SDK.

Ubicación de origen de una afirmación de proposición o de cadena de razonamiento. Un ID de
mensaje la ancla a un pasaje del transcript nativo; la procedencia a nivel de chat y la de
ficheros importados pueden omitir ese ancla usando un messageId vacío.

```ts
export interface ProvenancePoint {
    chatId: string;
    messageId: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#provenancepoint-chatid)
- [messageId](#provenancepoint-messageid)

### ProvenancePoint chatId

El chat al que se ancla este punto, o un id de fuente de notas ("src_…"):
las importaciones no llevan anclas de mensaje (la procedencia es el propio fichero,
registrada mediante la línea de correspondencia + el registro de la fuente).

```ts
chatId: string;
```

### ProvenancePoint messageId

```ts
messageId: string;
```

## SessionCheckpoint

Tipo público del SDK, exportado como `SessionCheckpoint`. Impórtalo con `import type`; el SDK no tiene exportaciones en tiempo de ejecución.

Línea de sessions.jsonl: el punto de control de emisión de un chat (qué chats
se han plegado, y hasta qué updatedAt; nunca plegar dos veces).

```ts
export interface SessionCheckpoint {
    chatId: string;
    foldedAt: string;
}
```

**Índice de miembros** (incluidos los miembros de objetos anidados; los miembros heredados se definen en los tipos base enlazados):

- [chatId](#sessioncheckpoint-chatid)
- [foldedAt](#sessioncheckpoint-foldedat)

### SessionCheckpoint chatId

```ts
chatId: string;
```

### SessionCheckpoint foldedAt

El `updatedAt` del registro del chat en el momento del pliegue.

```ts
foldedAt: string;
```
