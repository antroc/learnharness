# Pruebas de la skill de datos de LearnHarness

Se ejecutan con independencia de la aplicación, con Python 3.10+ y sin dependencias:

```sh
python3 -B -m unittest discover -s tests/skills -v
```

Estas pruebas ejercitan los lectores autocontenidos de `skills/learnharness/` contra
pequeños registros sintéticos y los datos de referencia nativos de
`tests/fixtures/golden-data/`. Comprueban que se conserva la evidencia de aprendizaje, la
selección y fusión del grafo, los formatos no admitidos, los límites de rutas y que los
bytes y los mtime de los ficheros no cambian. Una prueba de portabilidad copia la skill y
los datos de prueba fuera del repositorio e invoca ambos formatos de salida desde un
directorio de trabajo sin relación, comprobando que no aparecen ficheros de caché ni de
datos.

No se usa ningún perfil real de usuario instalado, claves de proveedores, servidor de la
app, LLM ni red. El comando de pruebas está separado a propósito del conjunto de pruebas de
Node de la app; la skill no tiene integración con el runtime de la app, las versiones ni el
sitio web.
