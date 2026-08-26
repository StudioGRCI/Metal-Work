# La presentación del procedimiento

Arma, con capturas reales del sistema, la presentación de cómo se recorre una
orden de trabajo de la cotización a la entrega. Sale en dos formatos: un
`.pptx` que se puede editar y un `.pdf` que se puede mandar por correo.

Las capturas se toman contra el [banco de pruebas](../banco/README.md), nunca
contra el proyecto del cliente: así la presentación se puede rehacer cuando
cambie una pantalla, sin tocar datos reales.

## Cómo se rehace

Con el banco levantado y la aplicación corriendo en el puerto 3111:

```bash
SALIDA=/tmp/presentacion BANCO_CLAVE='la-del-banco' \
  node herramientas/presentacion/capturar.mjs

CAPTURAS=/tmp/presentacion RECORTES=/tmp/slides \
SALIDA_PPTX=/tmp/Procedimiento-Orden-de-Trabajo.pptx \
SALIDA_HTML=/tmp/procedimiento.html \
  python3 herramientas/presentacion/armar.py

chromium --headless --print-to-pdf=/tmp/Procedimiento-Orden-de-Trabajo.pdf \
  --no-pdf-header-footer file:///tmp/procedimiento.html
```

`armar.py` necesita `python-pptx` y `pillow`.

El PDF no sale del `.pptx` sino de un HTML con el mismo contenido y el mismo
diseño. Es a propósito: convertir el `.pptx` exige LibreOffice con Impress, que
no está en todas las máquinas, y el HTML se imprime con el mismo navegador que
ya se usa para capturar.

Para comprobar que ningún título o explicación desborda su lámina:

```bash
S=/tmp node herramientas/presentacion/revisar.mjs
```

## Qué contiene

Portada, el recorrido en una página, una lámina por pantalla agrupadas en las
seis etapas del procedimiento —se cotiza, se abre la orden, se aprueba, se
fabrica, se verifica, se entrega— y un cierre con lo que queda verificado al
entregar la unidad.

El texto de cada lámina vive en `armar.py`, en la lista `PASOS`. Para agregar
una pantalla se suma su ruta en `capturar.mjs` y su explicación acá.
