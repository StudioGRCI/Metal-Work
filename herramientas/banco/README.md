# Banco de pruebas

Levanta el sistema completo en la máquina, sin nube: una base Postgres con el
esquema y los datos de demostración, y un servicio que responde lo mismo que
Supabase —ingreso de sesión, datos y archivos— para que la aplicación funcione
igual que en producción.

Sirve para dos cosas:

1. **Comprobar de punta a punta antes de subir.** Se entra a la aplicación, se
   recorren las pantallas y se contrasta lo que muestran contra la base.
2. **Trabajar sin tocar los datos del cliente.** Nada de lo que se pruebe acá
   llega al proyecto real.

## Cómo se usa

```bash
BANCO_CLAVE='la-que-quieras' ./herramientas/banco/preparar.sh   # rehace la base local
node herramientas/banco/servidor.mjs                            # levanta el servicio (puerto 5599)
```

El servicio imprime al arrancar las tres variables que hay que darle a la
aplicación. Con ellas:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:5599 \
NEXT_PUBLIC_SUPABASE_ANON_KEY=<la que imprimió> \
SUPABASE_SERVICE_ROLE_KEY=<la que imprimió> \
npx next dev -p 3111
```

Y para el recorrido automático de todas las pantallas:

```bash
BANCO_CLAVE='la-que-quieras' node herramientas/banco/recorrer.mjs
```

Entra con la cuenta de demostración, visita las 27 rutas —las de detalle con
identificadores sacados de la propia base—, anota el estado y el título de cada
una, recoge los errores de consola y guarda las capturas. Termina con código
distinto de cero si alguna pantalla falló, así que sirve tal cual en una
comprobación automática.

Y para lo que no se ve mirando pantallas —lo que pasa al apretar los botones—:

```bash
BANCO_CLAVE='la-que-quieras' node herramientas/banco/probar-cotizacion.mjs
```

Emite una cotización, la descarga en PDF, comprueba que el borrador descargado
queda marcado como enviado, intenta anularla sin motivo (no la deja), la anula
con motivo y vuelve a descargarla ya anulada.

## Qué hay dentro

| Archivo | Qué hace |
| --- | --- |
| `preparar.sh` | Rehace la base: esquema, migraciones, empresa, cuenta de administración y datos de demostración. |
| `servidor.mjs` | El servicio: sesión, datos y archivos, en un solo puerto. |
| `rest.mjs` | Traduce las peticiones de datos a SQL. |
| `esquema.mjs` | Lee las claves foráneas para resolver las incrustaciones. |
| `recorrer.mjs` | Recorre la aplicación con un navegador y deja el informe y las capturas. |
| `probar-cotizacion.mjs` | Aprieta los botones de una cotización: emitir, descargar el PDF, anular con motivo y volver a descargar. |

## Lo que respeta y lo que no

**Respeta las reglas de seguridad.** Cada petición corre dentro de una
transacción con `set local role` y los datos de la sesión, así que las políticas
de la base se aplican igual que en Supabase: si una política tapa una fila, acá
también la tapa. Es lo que permite probar de verdad qué ve cada rol.

**Falla en voz alta.** Ante cualquier cosa que no sepa traducir responde 501 con
el motivo, nunca una lista vacía. Una pantalla vacía se parece demasiado a una
pantalla correcta sin datos, y esa confusión es justamente lo que haría inútil
la comprobación.

**No adivina relaciones.** Cuando hay más de un camino entre dos tablas exige la
pista explícita (`usuarios!nombre_de_la_clave`), igual que Supabase. Elegir uno
por cuenta propia escondería acá un error que en producción sí ocurre: así se
encontró que la pantalla de cotizaciones se rompía, porque `cotizaciones` apunta
dos veces a `unidades`.

**Traduce lo que la aplicación usa, no todo lo que existe.** Selección con
incrustaciones y conteos, filtros, orden, rango, conteo exacto, altas, cambios,
bajas y llamadas a función. Lo demás —vistas materializadas de la API, formatos
distintos de JSON, `upsert`, filtros sobre incrustaciones anidadas— no está: si
la aplicación empieza a usarlo, el banco lo dirá con un 501 y habrá que
agregarlo acá.

**Las contraseñas se pasan al ejecutar, nunca escritas acá.** La de la cuenta de
administración local es la que reciba `preparar.sh` en `BANCO_CLAVE`, y el resto
del personal de demostración se crea sin contraseña: existe como ficha pero no
puede entrar hasta que se le asigne una con `db/demo/claves-demo.sql`. Lo que se
escribe en el repositorio deja de ser secreto, y este repositorio es público.
