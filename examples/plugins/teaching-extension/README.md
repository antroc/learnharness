# Ejemplo de extensión de enseñanza

Un fixture para desarrolladores deliberadamente pequeño para las lecciones existentes, no una
función de tarjetas de memoria independiente ni un sistema de ejecución de código o de
respuestas del alumno.

Copia este directorio en el directorio de plugins que se muestra en **Ajustes → Plugins de la comunidad**,
conservando la carpeta `teaching-extension/` y su `dist/manifest.json` obligatorio. No hace
falta compilar nada. Actualiza y activa **Teaching extension example**. Edita los ficheros de
runtime en `dist/` y reinicia LearnHarness después de cambiar código ya cargado. Conserva la
carpeta hermana `teaching-extension/data/` al sustituir `dist/`; no distribuyas nunca esos
datos persistentes ni los pongas en `dist/data/`. Nunca se instala ni se activa
automáticamente.

En una sesión de profesor o de práctica:

1. Pide explícitamente probar la herramienta de eco de teaching-extension. Devuelve un
   resultado nativo de Pi con una tarjeta de transcripción personalizada; la herramienta no
   hace ninguna petición adicional al modelo.
2. Pide un bloque delimitado `plugin-note`. Su cuerpo se renderiza con DOM/textContent simple.
3. Pide explícitamente el **ejemplo de worker en segundo plano** sobre un tema. El profesor
   llama a `teaching_extension_note`, que devuelve de inmediato un acuse de despacho. Un
   pequeño worker nativo escribe una nota y envía un resultado validado por esquema y
   semánticamente; el resultado llega después a través de la cadena de entrega de la lección
   existente.

El paso 3 **puede generar coste de modelo** y requiere una ranura de modelo barato configurada
con permiso para uso en segundo plano. Sus límites (3 turnos de modelo, 1.024 tokens de salida
por petición, 60 segundos de tiempo real) son elecciones del ejemplo, no valores por defecto
del host. No se ejecuta nada automáticamente solo por abrir el plugin o sus ajustes.

Desactivarlo elimina las instrucciones, herramientas y renderizadores de los turnos futuros e
interrumpe los workers sin terminar. Las llamadas y los resultados nativos existentes siguen
guardados. La llamada original al worker sigue siendo un acuse de despacho; el resultado
posterior es un marcador guardado aparte. La alternativa en bruto sigue siendo legible sin este
plugin. Los registros de tareas completadas sobreviven a la desactivación y al reinicio.

Es una extensión silenciosa y sin interfaz: no registra ninguna vista, acción ni ubicación. Su
montaje personalizado `registerSettings((container, signal) => …)` se conserva a propósito como
vía de escape para contenido explicativo. No hay comportamientos configurables que exponer como
ajustes de esquema; abrir este contenido no inicia ningún worker.

Los ficheros usan solo el contexto público admitido, sin importaciones privadas de la app ni
`npm install` en tiempo de ejecución. El backend no tiene almacenamiento de producto propio ni
escribe datos de aprendizaje principales. El host se encarga de los registros de tareas y de la
contabilidad de uso en el directorio hermano `data/` del espacio de trabajo instalado.

Cobertura de integración sin red: `tests/plugin-teaching-integration.test.ts` carga este
backend CommonJS externo real, construye el profesor nativo real, ejecuta un worker guionizado
mediante el adaptador de inferencia, observa la entrega por separado y hace el viaje de ida y
vuelta del historial nativo por los almacenes normales. Esto no es una afirmación de aceptación
con proveedores reales ni de aceptación funcional humana.
