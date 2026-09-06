/**
 * Graba en video el circuito completo, cuenta por cuenta, como lo haría la
 * empresa: Ventas cotiza, Diseño o Administración costea, Gerencia da el visto
 * y aprueba, Administración emite la orden, Gerencia la libera y Diseño arma
 * los planos, escribe el material y lo manda al almacén.
 *
 *   URL=... CLAVE='...' SALIDA=<carpeta> \
 *   node herramientas/recorrido/circuito-grabado.mjs venta
 *
 * Va por tramos y no de una sola vez, a propósito: son ocho pantallas con
 * formularios de verdad y documentos numerados de la serie real. Si un tramo
 * falla, lo que ya se hizo está en la base y se retoma desde el siguiente en
 * vez de volver a consumir números. El estado viaja en `estado.json`.
 *
 * Cada tramo deja su propio `.webm`; `montar` los une en uno solo.
 *
 * Los rótulos en pantalla no son adorno: el video no tiene voz, y sin ellos
 * quien lo mire ve formularios llenándose solos sin saber quién los llena.
 */
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const URL_BASE = process.env.URL ?? 'https://metal-work-sandy.vercel.app'
const CLAVE = process.env.CLAVE ?? ''
const SALIDA = process.env.SALIDA ?? 'capturas/circuito-grabado'
const TRAMO = process.argv[2] ?? 'venta'

const CUENTAS = {
  ventas: 'ventas@metalworkperusac.com',
  administracion: 'administracion@metalworkperusac.com',
  gerencia: 'gerencia@metalworkperusac.com',
  diseno: 'diseno@metalworkperusac.com',
}

const NAVEGADORES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
]

/** El orden del circuito, para que los videos se monten en su secuencia. */
const ORDEN = {
  venta: 1,
  trabajo: 2,
  ficha: 3,
  cerrar_costeo: 4,
  visto: 5,
  envio: 6,
  aprobacion: 7,
  orden: 8,
  libera: 9,
  diseno: 10,
  repaso: 11,
}

const archivoEstado = join(SALIDA, 'estado.json')
const estado = existsSync(archivoEstado) ? JSON.parse(readFileSync(archivoEstado, 'utf8')) : {}
const guardar = () => writeFileSync(archivoEstado, JSON.stringify(estado, null, 2))

// --------------------------------------------------------------- ayudantes

/** El cartel de arriba: quién está mirando la pantalla y qué está haciendo. */
async function rotulo(pagina, quien, texto) {
  await pagina.evaluate(
    ([quien, texto]) => {
      let caja = document.getElementById('rotulo-circuito')
      if (!caja) {
        caja = document.createElement('div')
        caja.id = 'rotulo-circuito'
        caja.style.cssText = [
          'position:fixed', 'z-index:2147483647', 'left:0', 'right:0', 'top:0',
          'padding:10px 16px', 'background:#0f2942', 'color:#fff',
          'font:600 15px/1.35 system-ui,sans-serif', 'display:flex', 'gap:12px',
          'align-items:center', 'box-shadow:0 2px 12px rgba(0,0,0,.35)',
          // Sin esto el cartel se come los clics de lo que queda debajo y el
          // recorrido se cae con «rotulo-circuito intercepts pointer events».
          'pointer-events:none',
        ].join(';')
        document.body.appendChild(caja)
      }
      caja.innerHTML =
        `<span style="background:#2f6fed;padding:3px 10px;border-radius:999px;font-size:13px">${quien}</span>` +
        `<span style="font-weight:500">${texto}</span>`
    },
    [quien, texto],
  )
}

const respirar = (pagina, ms = 1200) => pagina.waitForTimeout(ms)

async function entrar(pagina, cuenta, quien, texto) {
  await pagina.goto(`${URL_BASE}/ingresar`, { waitUntil: 'commit', timeout: 60000 })
  await pagina.locator('input[type="password"]').waitFor({ state: 'visible', timeout: 60000 })
  await pagina.waitForTimeout(2500)
  await rotulo(pagina, quien, texto)
  // Escrito letra a letra: en el video se tiene que ver quién entra.
  await pagina.type('input[type="email"], input[name="correo"]', CUENTAS[cuenta], { delay: 35 })
  await pagina.fill('input[type="password"]', CLAVE)
  await respirar(pagina, 600)
  await pagina.click('button[type="submit"]')
  await pagina.waitForURL((u) => !u.pathname.includes('/ingresar'), { timeout: 90000 })
  await respirar(pagina, 2500)
  await rotulo(pagina, quien, texto)
}

async function salir(pagina) {
  const boton = pagina.locator('[aria-label="Cerrar sesión"]')
  if (await boton.count()) {
    await boton.first().click()
    await pagina.waitForURL((u) => u.pathname.includes('/ingresar'), { timeout: 60000 }).catch(() => {})
  }
  await respirar(pagina, 1200)
}

/**
 * Los desplegables buscables del sistema: se abren, se escribe y se elige.
 *
 * Si lo escrito no encuentra nada, se borra y se toma la primera opción en vez
 * de quedarse esperando a un `[role="option"]` que no va a existir: la lista
 * dice «Nada coincide con lo que escribiste» y ahí se quedaba el recorrido
 * treinta segundos hasta vencer. Un catálogo que cambió de nombre no puede
 * tumbar la grabación entera.
 */
async function elegir(pagina, id, busqueda, textoOpcion) {
  await pagina.locator(`#${id}`).click()
  await respirar(pagina, 500)

  // La caja de búsqueda del desplegable, y no cualquier `input[aria-label]`:
  // la tabla de materiales tiene una casilla «Pedir …» por fila, también con
  // aria-label, y el guion terminaba escribiendo el nombre del material dentro
  // de un checkbox —«Input of type checkbox cannot be filled»—.
  const caja = pagina
    .locator('input[aria-label]:not([type="checkbox"]):not([type="number"]):not([type="date"]):visible')
    .last()
  if (busqueda) {
    await caja.type(busqueda, { delay: 40 })
    await respirar(pagina, 900)
    if ((await pagina.locator('[role="option"]').count()) === 0) {
      console.log(`  («${busqueda}» no encontró nada en ${id}: se toma la primera de la lista)`)
      await caja.fill('')
      await respirar(pagina, 700)
    }
  }

  let opcion = pagina.locator('[role="option"]').first()
  if (textoOpcion) {
    const conTexto = pagina.locator('[role="option"]', { hasText: textoOpcion }).first()
    if (await conTexto.count()) opcion = conTexto
  }
  await opcion.waitFor({ state: 'visible', timeout: 15000 })
  await opcion.click()
  await respirar(pagina, 600)
}

async function irA(pagina, ruta, quien, texto) {
  await pagina.goto(`${URL_BASE}${ruta}`, { waitUntil: 'commit', timeout: 60000 })
  await pagina.waitForLoadState('domcontentloaded')
  await respirar(pagina, 2500)
  await rotulo(pagina, quien, texto)
}

/**
 * Un botón por su texto.
 *
 * `opcional` existe porque los tramos se pueden repetir: si el paso ya se dio,
 * el botón que lo daba desaparece —una cotización que ya salió de BORRADOR no
 * tiene «Pasar a cotización de trabajo»— y eso no es un fallo, es que no hay
 * nada que hacer. `ultimo` es para cuando el mismo texto abre el formulario y
 * lo envía: el de abajo es el de enviar.
 */
async function pulsar(pagina, texto, espera = 2500, { opcional = false, ultimo = false } = {}) {
  const botones = pagina.getByRole('button', { name: new RegExp(texto, 'i') })
  const boton = ultimo ? botones.last() : botones.first()

  const hay = await boton
    .waitFor({ state: 'visible', timeout: opcional ? 8000 : 30000 })
    .then(() => true)
    .catch(() => false)

  if (!hay) {
    if (opcional) {
      console.log(`  (sin botón «${texto}»: ese paso ya estaba dado)`)
      return false
    }
    throw new Error(`no apareció el botón «${texto}» en ${pagina.url()}`)
  }

  await boton.scrollIntoViewIfNeeded()
  await respirar(pagina, 700)
  await boton.click()
  await respirar(pagina, espera)
  return true
}

/**
 * Lo que la pantalla dice después de un envío.
 *
 * Sin esto el recorrido «pasa» sin haber guardado nada: se pulsa, la acción
 * devuelve un error, la pantalla lo pinta en su `[role="alert"]` y el guion
 * sigue tan contento. Ya ocurrió con las partidas del costeo: tres agregadas,
 * cero en la base, tramo «terminado».
 *
 * El hueco del aviso existe siempre y está vacío mientras no hay nada que
 * decir, así que se filtran los vacíos.
 */
async function quejas(pagina) {
  return pagina
    .locator('[role="alert"]:visible')
    .allTextContents()
    .then((ts) => ts.map((t) => t.trim()).filter(Boolean))
    .catch(() => [])
}

/**
 * Pulsa y comprueba que de verdad se envió.
 *
 * Dos comprobaciones, y la segunda costó una vuelta entera: un campo requerido
 * sin llenar lo para el **navegador**, con su globito «Selecciona un elemento de
 * la lista», y eso no es un `[role="alert"]` ni un error de la acción. El
 * formulario simplemente no se manda y todo parece haber ido bien. Se mira
 * `:invalid` antes de pulsar, que es donde el navegador lo deja escrito.
 */
async function pulsarYComprobar(pagina, texto, espera = 3500, opciones = {}) {
  // Solo el formulario del botón que se va a pulsar. Mirar `form :invalid` de
  // toda la página daba falsos positivos: la misma pantalla tiene otros
  // formularios con campos requeridos vacíos que no son asunto de este paso
  // —«Guardar esta ficha como plantilla», por ejemplo—.
  const botones = pagina.getByRole('button', { name: new RegExp(texto, 'i') })
  const boton = opciones.ultimo ? botones.last() : botones.first()
  const cuales = await boton
    .locator('xpath=ancestor::form[1]')
    .locator(':invalid')
    .evaluateAll((nodos) => nodos.map((n) => n.getAttribute('name') || n.tagName))
    .catch(() => [])

  if (cuales.length > 0) {
    throw new Error(`el formulario no está completo: ${cuales.join(', ')}`)
  }

  await pulsar(pagina, texto, espera, opciones)

  const dichos = await quejas(pagina)
  if (dichos.length) {
    throw new Error(`«${texto}» no guardó: ${dichos.join(' · ')}`)
  }
}

/**
 * Espera a que la pantalla enseñe el resultado, que es la única prueba de que
 * la acción entró. Pulsar y ver que no salta un error no alcanza: una
 * transición que la base rechaza deja la pantalla igual y el guion canta
 * victoria. Pasó con «Terminar el costeo»: tramo en verde, estado sin mover.
 */
async function esperarTexto(pagina, texto, segundos = 20) {
  const visto = await pagina
    .getByText(new RegExp(texto, 'i'))
    .first()
    .waitFor({ state: 'visible', timeout: segundos * 1000 })
    .then(() => true)
    .catch(() => false)

  if (!visto) {
    const dichos = await quejas(pagina)
    throw new Error(
      `la pantalla nunca mostró «${texto}»${dichos.length ? `; dijo: ${dichos.join(' · ')}` : ''}`,
    )
  }
}

/**
 * Un desplegable normal, por parte del texto de la opción.
 *
 * Parte y no todo: varias listas del sistema le pegan al nombre información de
 * más —la clasificación muestra «Estructura → Habilitado de materia prima»—, y
 * pedir el texto exacto falla con «did not find some options».
 */
async function elegirEnLista(pagina, nombre, textoOpcion) {
  const lista = pagina.locator(`select[name="${nombre}"]:visible`).last()
  await lista.waitFor({ state: 'visible', timeout: 20000 })

  const valor = await lista.evaluate((select, texto) => {
    const opcion = [...select.options].find(
      (o) => o.value && o.textContent.toLowerCase().includes(texto.toLowerCase()),
    )
    return opcion ? opcion.value : null
  }, textoOpcion)

  if (!valor) throw new Error(`«${textoOpcion}» no está en la lista ${nombre}`)
  await lista.selectOption(valor)
  await respirar(pagina, 400)
}

/** Rellena un campo del formulario visible por su atributo `name`. */
async function escribir(pagina, nombre, valor, { ultimo = true } = {}) {
  const campos = pagina.locator(`[name="${nombre}"]:visible`)
  const campo = ultimo ? campos.last() : campos.first()
  await campo.waitFor({ state: 'visible', timeout: 20000 })
  await campo.fill(String(valor))
  await respirar(pagina, 300)
}

// ------------------------------------------------------------------ tramos

const TRAMOS = {
  /** Ventas arma la cotización y la manda a costear. */
  async venta(pagina) {
    const quien = 'Karina · Comercial'
    await entrar(pagina, 'ventas', quien, 'Entra la ejecutiva comercial')

    // Si el tramo ya creó la cotización y se cayó después, se retoma. Volver a
    // crearla consumiría otro número de la serie de la empresa, y esos no se
    // devuelven ni se borran.
    if (estado.cotizacion) {
      console.log(`  (retomando la cotización ${estado.cotizacion})`)
      await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien,
        'La cotización que ya estaba empezada')
      await pulsar(pagina, 'Pasar a cotización de trabajo', 5000)
      await rotulo(pagina, quien, 'Y se la manda a Diseño para que la costee')
      await respirar(pagina, 3000)
      await salir(pagina)
      return
    }

    await irA(pagina, '/cotizaciones', quien, 'Sus cotizaciones: acá empieza todo')
    await irA(pagina, '/cotizaciones/nueva', quien, 'Nueva cotización de venta')

    await elegir(pagina, 'cliente_id', 'MENBER', null)
    await rotulo(pagina, quien, 'El cliente que pidió la unidad')

    await pagina.selectOption('#tipo_unidad', 'SEMIRREMOLQUE').catch(() => {})
    await pagina.fill('#capacidad', '30 m³')
    await respirar(pagina, 500)
    await elegir(pagina, 'tipo_carroceria_id', 'TOLVA', null)
    await rotulo(pagina, quien, 'Tipo, capacidad y carrocería: el código de producto de la casa')

    await pagina.fill('#precio_venta', '48000')
    await pagina.fill('#plazo_entrega_dias', '45')
    await respirar(pagina, 800)
    await rotulo(pagina, quien, 'El precio lo pone Ventas, y manda sobre el papel')

    await pulsar(pagina, 'Guardar|Crear|Registrar', 6000)
    await pagina.waitForURL(/\/cotizaciones\/[0-9a-f-]{36}/, { timeout: 60000 })
    estado.cotizacion = pagina.url().split('/').pop().split('?')[0]
    guardar()

    await rotulo(pagina, quien, 'Cotización creada: ya tiene su número de la serie')
    await respirar(pagina, 3000)

    await pulsar(pagina, 'Pasar a cotización de trabajo', 5000)
    await rotulo(pagina, quien, 'Y se la manda a Diseño para que la costee')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /**
   * Diagnóstico: abre el formulario de partidas y va contando lo que ve.
   * No es parte del video; está para cuando un tramo «pasa» sin guardar.
   */
  async diag(pagina) {
    const quien = 'Diagnóstico'
    await entrar(pagina, 'administracion', quien, 'Diagnóstico del formulario de partidas')
    await irA(pagina, `/cotizaciones/trabajo/${estado.cotizacion}`, quien, 'Cotización de trabajo')

    const cuenta = async (que, sel) =>
      console.log(`  ${que}: ${await pagina.locator(sel).count()}`)

    await cuenta('botones «Agregar partida» visibles', 'button:visible:has-text("Agregar partida")')
    await pulsar(pagina, 'Agregar partida', 2000)
    await pagina.screenshot({ path: join(SALIDA, 'diag-1-abierto.png'), fullPage: true })

    await cuenta('campos descripcion visibles', '[name="descripcion"]:visible')
    await cuenta('campos cantidad visibles', '[name="cantidad"]:visible')
    await cuenta('campos precio_unitario visibles', '[name="precio_unitario"]:visible')
    await cuenta('selects clasificacion visibles', '[name="clasificacion_id"]:visible')
    await cuenta('botones «Agregar partida» tras abrir', 'button:visible:has-text("Agregar partida")')

    await escribir(pagina, 'descripcion', 'PRUEBA DE DIAGNÓSTICO')
    await escribir(pagina, 'cantidad', 1)
    await escribir(pagina, 'precio_unitario', 100)
    await pagina.screenshot({ path: join(SALIDA, 'diag-2-lleno.png'), fullPage: true })

    await pulsar(pagina, 'Agregar partida', 5000, { ultimo: true })
    await pagina.screenshot({ path: join(SALIDA, 'diag-3-enviado.png'), fullPage: true })

    console.log(`  quejas: ${JSON.stringify(await quejas(pagina))}`)
    await cuenta('filas de partida en pantalla', 'text=PRUEBA DE DIAGNÓSTICO')
  },

  /** Administración arma la cotización de trabajo: las partidas del costeo. */
  async trabajo(pagina) {
    const quien = 'Administración'
    await entrar(pagina, 'administracion', quien, 'Entra Administración, que costea')

    await irA(pagina, `/cotizaciones/trabajo/${estado.cotizacion}`, quien,
      'La cotización de trabajo: acá va el costo, y esto no lo ve Ventas')

    // La clasificación no es una etiqueta: dice a qué área del taller va la
    // partida, y de ella cuelga el reparto del material cuando la cotización se
    // vuelve orden. Por eso cada una lleva la suya y no todas «Otros».
    const PARTIDAS = [
      {
        descripcion: 'Estructura del cajón en plancha LAC A36 6 mm',
        clasificacion: 'Estructura',
        cantidad: 1,
        precio: 9800,
      },
      {
        descripcion: 'Piso en plancha antidesgaste Hardox 450 de 8 mm',
        clasificacion: 'Estructura',
        cantidad: 1,
        precio: 7400,
      },
      {
        descripcion: 'Arenado y pintura epóxica de acabado',
        clasificacion: 'Acabados',
        cantidad: 1,
        precio: 2600,
      },
    ]

    for (const partida of PARTIDAS) {
      await pulsar(pagina, 'Agregar partida', 1500)
      await escribir(pagina, 'descripcion', partida.descripcion)
      await elegirEnLista(pagina, 'clasificacion_id', partida.clasificacion)
      await escribir(pagina, 'cantidad', partida.cantidad)
      await escribir(pagina, 'precio_unitario', partida.precio)
      await rotulo(pagina, quien, `${partida.clasificacion} · ${partida.descripcion}`)
      await respirar(pagina, 900)
      // El mismo texto abre el formulario y lo envía: el de enviar es el último.
      await pulsarYComprobar(pagina, 'Agregar partida', 3500, { ultimo: true })
    }

    // Lo que quedó escrito, no lo que se creyó escribir: se busca el texto de
    // la última partida en la pantalla.
    const puesta = await pagina.getByText(PARTIDAS[2].descripcion).count()
    if (puesta === 0) throw new Error('las partidas no quedaron en la tabla')
    console.log(`  (las ${PARTIDAS.length} partidas están en pantalla)`)

    await rotulo(pagina, quien, 'Con el costeo armado, vuelve a Gerencia')
    await respirar(pagina, 2500)

    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien, 'La cotización, ya costeada')
    await pulsar(pagina, 'Terminar el costeo', 6000)
    await rotulo(pagina, quien, 'Terminado el costeo: pasa a revisión de Gerencia')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /**
   * La ficha técnica: qué se va a fabricar exactamente.
   *
   * No es un adorno del costeo. La base no deja subir la cotización a Gerencia
   * sin ella —«es lo que el taller va a fabricar y contra lo que el cliente
   * reclama»— y lo dice con esas palabras al intentarlo. Se aplica la plantilla
   * de la carrocería, que es como trabaja la casa: la tolva ya tiene su ficha
   * escrita de las OT anteriores y acá solo se ajusta lo que cambie.
   */
  async ficha(pagina) {
    const quien = 'Administración'
    await entrar(pagina, 'administracion', quien, 'Falta la ficha técnica del trabajo')
    await irA(pagina, `/cotizaciones/trabajo/${estado.cotizacion}`, quien,
      'La ficha dice qué se fabrica; sin ella la cotización no sube a Gerencia')

    // Si la carrocería tiene una ficha guardada de trabajos anteriores, se
    // aplica y listo; esta tolva todavía no tiene ninguna, así que se escribe.
    const lista = pagina.locator('select[name="plantilla_id"]:visible').first()
    const hayPlantilla = await lista
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false)

    if (hayPlantilla) {
      const valor = await lista.evaluate((s) => [...s.options].find((o) => o.value)?.value ?? null)
      if (valor) {
        await lista.selectOption(valor)
        await rotulo(pagina, quien, 'La carrocería ya tiene su ficha escrita de trabajos anteriores')
        await respirar(pagina, 1500)
        await pulsar(pagina, 'Aplicar', 6000)
        await rotulo(pagina, quien, 'Aplicada: espesores, normas y accesorios de la casa')
        await respirar(pagina, 3500)
        await salir(pagina)
        return
      }
    }

    const LINEAS = [
      { seccion: 'ESTRUCTURA', etiqueta: 'Piso', detalle: 'Plancha antidesgaste HARDOX 450 de 8 mm' },
      { seccion: 'ESTRUCTURA', etiqueta: 'Laterales', detalle: 'Plancha LAC ASTM A36 de 6 mm con refuerzos tubulares' },
      { seccion: 'ACABADOS', etiqueta: 'Pintura', detalle: 'Arenado comercial y base epóxica, acabado poliuretano al color del cliente' },
    ]

    for (const linea of LINEAS) {
      // Idempotente: si la línea ya está escrita —el tramo se cayó a mitad y se
      // repite— no se vuelve a agregar.
      if (await pagina.getByText(linea.detalle).count()) {
        console.log(`  (ya estaba: ${linea.etiqueta})`)
        continue
      }

      // El formulario se cierra al guardar cada línea, así que se abre en cada
      // vuelta y se espera al campo, no al clic.
      if (!(await pagina.locator('#seccion').isVisible().catch(() => false))) {
        await pulsar(pagina, 'Escribir la primera línea|Agregar línea', 1200)
        await pagina.locator('#seccion').waitFor({ state: 'visible', timeout: 20000 })
      }

      await pagina.locator('#seccion').fill(linea.seccion)
      await pagina.locator('#etiqueta').fill(linea.etiqueta)
      await pagina.locator('#detalle').fill(linea.detalle)
      await rotulo(pagina, quien, `${linea.seccion} · ${linea.detalle}`)
      await respirar(pagina, 1000)
      await pulsarYComprobar(pagina, 'Agregar línea', 3500, { ultimo: true })
      await esperarTexto(pagina, linea.detalle.slice(0, 30))
    }

    await esperarTexto(pagina, 'HARDOX 450')
    await rotulo(pagina, quien, 'Con la ficha escrita, la cotización ya puede subir a Gerencia')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /**
   * Solo cerrar el costeo. Existe aparte porque el botón vive en la pantalla de
   * la cotización de venta, no en la de trabajo, y repetir el tramo entero para
   * pulsarlo agregaría otras tres partidas.
   */
  async cerrar_costeo(pagina) {
    const quien = 'Administración'
    await entrar(pagina, 'administracion', quien, 'Administración cierra el costeo')
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien,
      'La cotización con su costeo: 19.800 de costo contra 48.000 ofrecidos')
    await pulsar(pagina, 'Terminar el costeo', 6000)
    await esperarTexto(pagina, 'En revisión')
    await rotulo(pagina, quien, 'Sube a Gerencia para el visto')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /** Gerencia da el visto. */
  async visto(pagina) {
    const quien = 'Aníbal · Gerencia'
    await entrar(pagina, 'gerencia', quien, 'Entra Gerencia')
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien,
      'Gerencia revisa lo que se le va a ofrecer al cliente')
    await pulsar(pagina, 'Dar el visto', 5000, { opcional: true })
    await rotulo(pagina, quien, 'Con el visto puesto, ya se le puede mandar al cliente')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /** Ventas manda el papel al cliente: descargarlo es mandarlo. */
  async envio(pagina) {
    const quien = 'Karina · Comercial'
    await entrar(pagina, 'ventas', quien, 'Vuelve Ventas para mandarle el papel al cliente')
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien,
      'La cotización con el visto de Gerencia')

    // Descargar el PDF es lo que la marca como enviada: no hay un botón
    // «marcar enviada» aparte, a propósito.
    const descarga = pagina.waitForEvent('download', { timeout: 60000 }).catch(() => null)
    await pulsar(pagina, 'Descargar y enviar|Enviar al cliente|Descargar', 6000, { opcional: true })
    const archivo = await descarga
    if (archivo) {
      await archivo.saveAs(join(SALIDA, `cotizacion-${estado.cotizacion}.pdf`))
      console.log('  (se descargó el PDF de la cotización)')
    }
    await rotulo(pagina, quien, 'Mandada al cliente: la cotización queda ENVIADA')
    await respirar(pagina, 3500)
    await salir(pagina)
  },

  /** El cliente aceptó: Gerencia la marca aprobada. */
  async aprobacion(pagina) {
    const quien = 'Aníbal · Gerencia'
    await entrar(pagina, 'gerencia', quien, 'El cliente aceptó, y Gerencia lo registra')
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien, 'La cotización enviada')
    await pulsar(pagina, 'Marcar aprobada', 5000, { opcional: true })
    await rotulo(pagina, quien, 'APROBADA: ya se puede emitir la orden de trabajo')
    await respirar(pagina, 3000)
    await salir(pagina)
  },

  /** Administración emite la orden de trabajo. */
  async orden(pagina) {
    const quien = 'Administración'
    await entrar(pagina, 'administracion', quien, 'Administración emite la orden de trabajo')
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien, 'La cotización aprobada')

    // «Abrir orden de trabajo» abre la ventana; «Abrir orden», dentro, la crea.
    await pulsar(pagina, 'Abrir orden de trabajo', 2500)
    await rotulo(pagina, quien, 'De la cotización aprobada nace la OT, con su presupuesto')
    await respirar(pagina, 1800)
    await pulsar(pagina, '^Abrir orden$', 9000, { ultimo: true })

    await pagina.waitForURL(/\/ordenes\/[0-9a-f-]{36}/, { timeout: 60000 })
    estado.orden = pagina.url().split('/').pop().split('?')[0]
    guardar()
    await rotulo(pagina, quien, 'Orden de trabajo emitida, con su número de la serie')
    await respirar(pagina, 3500)
    await salir(pagina)
  },

  /** Gerencia aprueba la orden y la libera a producción. */
  async libera(pagina) {
    const quien = 'Aníbal · Gerencia'
    await entrar(pagina, 'gerencia', quien, 'Gerencia libera la orden a producción')
    await irA(pagina, `/ordenes/${estado.orden}`, quien, 'La orden recién emitida, en borrador')
    await pulsar(pagina, 'Aprobar', 8000, { opcional: true })
    await rotulo(pagina, quien, 'Aprobada: nacen las catorce etapas con sus fechas')
    await respirar(pagina, 3000)
    await irA(pagina, `/ordenes/${estado.orden}?vista=etapas`, quien,
      'Cada área ya sabe qué le toca y cuándo')
    await respirar(pagina, 4000)
    await salir(pagina)
  },

  /** Diseño: los planos, el material y el pedido al almacén. */
  async diseno(pagina) {
    const quien = 'Diseño e ingeniería'
    await entrar(pagina, 'diseno', quien, 'Entra Diseño: acá empieza la producción')

    // --------------------------------------------------- los planos y las piezas
    await irA(pagina, `/ordenes/${estado.orden}?vista=cumplimiento`, quien,
      'Diseño reparte el trabajo del taller: un plano por grupo de piezas')
    if ((await pagina.getByText('ESTRUCTURA DEL CAJÓN').count()) === 0) {
      await pulsar(pagina, 'Nuevo plano', 1500)
      await escribir(pagina, 'numero_plano', '1')
      await escribir(pagina, 'nombre', 'ESTRUCTURA DEL CAJÓN')
      await escribir(pagina, 'peso_pct', '60')
      await rotulo(pagina, quien, 'El plano, con lo que pesa en el avance de la unidad')
      await respirar(pagina, 1200)
      await pulsarYComprobar(pagina, 'Agregar el plano', 4000)
      await esperarTexto(pagina, 'ESTRUCTURA DEL CAJÓN')
    } else {
      console.log('  (el plano ya estaba)')
    }
    await rotulo(pagina, quien, 'Con el plano entregado, Maestranza ya puede reportar')
    await respirar(pagina, 3000)

    // --------------------------------------------------------- el material
    await irA(pagina, `/ordenes/${estado.orden}?vista=materiales`, quien,
      'Y acá dice qué material lleva la unidad: la OT no lo presupuesta, lo dice Diseño')

    const MATERIALES = [
      { busca: 'PL-A36-6', cantidad: '850' },
      { busca: 'PL-HRD-8', cantidad: '420' },
      { busca: 'ELE-7018', cantidad: '60' },
    ]

    for (const material of MATERIALES) {
      // El tramo se puede repetir: lo que ya está en la lista no se vuelve a
      // agregar —la base lo rechazaría por repetido, con razón—.
      if (await pagina.getByText(material.busca).count()) {
        console.log(`  (ya estaba en la lista: ${material.busca})`)
        continue
      }

      await pulsar(pagina, 'Agregar material', 1500)
      await elegir(pagina, 'nm-material', material.busca, null)
      await escribir(pagina, 'cantidad', material.cantidad)
      await rotulo(pagina, quien, `${material.busca}: ${material.cantidad}`)
      await respirar(pagina, 800)
      await pulsarYComprobar(pagina, 'Agregar a la lista', 3500)
      await esperarTexto(pagina, material.busca)
    }

    await rotulo(pagina, quien, 'La lista completa, con el stock que hay en almacén al lado')
    await respirar(pagina, 3000)

    // ------------------------------------------- el pedido, por porcentaje
    await escribir(pagina, 'mat-pct', '40', { ultimo: false }).catch(async () => {
      await pagina.locator('#mat-pct').fill('40')
    })
    await rotulo(pagina, quien, 'Se pide el 40 % de cada material ahora; el resto, después')
    await respirar(pagina, 1200)
    await pulsar(pagina, 'Aplicar', 2500)
    await rotulo(pagina, quien, 'La pantalla convierte el porcentaje en cantidades')
    await respirar(pagina, 2500)

    await pulsar(pagina, 'Mandar al requerimiento', 8000)
    await rotulo(pagina, quien, 'Y sale el requerimiento al almacén, ya armado')
    await respirar(pagina, 4000)

    if (/\/almacen\/requerimientos\//.test(pagina.url())) {
      estado.requerimiento = pagina.url().split('/').pop().split('?')[0]
      guardar()
    }

    await irA(pagina, `/ordenes/${estado.orden}?vista=materiales`, quien,
      'La lista ya sabe qué se pidió y qué queda pendiente')
    await respirar(pagina, 4000)
    await salir(pagina)
  },

  /**
   * El repaso: el camino andado, pantalla por pantalla y cuenta por cuenta.
   *
   * Va al final del video. Los primeros pasos —cotizar, costear, escribir la
   * ficha— se grabaron mientras se afinaba el guion y sus videos quedaron
   * mezclados entre los intentos, así que acá se enseña lo que dejaron, que es
   * lo que de verdad explica el circuito.
   */
  async repaso(pagina) {
    let quien = 'Karina · Comercial'
    await entrar(pagina, 'ventas', quien, 'Repaso del circuito · qué ve cada uno')
    await irA(pagina, '/cotizaciones', quien, '1 · Ventas cotizó: la 0003-2026, tolva de 30 m³')
    await respirar(pagina, 3500)
    await irA(pagina, `/cotizaciones/${estado.cotizacion}`, quien,
      'Aprobada por el cliente. Ventas no ve el costo: solo lo que se ofreció')
    await respirar(pagina, 4500)
    await salir(pagina)

    quien = 'Administración'
    await entrar(pagina, 'administracion', quien, '2 · Administración costeó el trabajo')
    await irA(pagina, `/cotizaciones/trabajo/${estado.cotizacion}`, quien,
      'La cotización de trabajo: ficha técnica, partidas y tiempo por área')
    await respirar(pagina, 4500)
    await pagina.mouse.wheel(0, 1200)
    await rotulo(pagina, quien, 'Las partidas: 19.800 de costo contra 48.000 ofrecidos')
    await respirar(pagina, 4000)
    await pagina.mouse.wheel(0, 1200)
    await rotulo(pagina, quien, 'Y el tiempo por área, que después es el plazo de cada etapa')
    await respirar(pagina, 4000)
    await salir(pagina)

    quien = 'Aníbal · Gerencia'
    await entrar(pagina, 'gerencia', quien, '3 · Gerencia aprobó y liberó la orden')
    await irA(pagina, `/ordenes/${estado.orden}?vista=etapas`, quien,
      'La OT 0001-2026 con sus catorce etapas y sus fechas')
    await respirar(pagina, 5000)
    await irA(pagina, `/ordenes/${estado.orden}?vista=cronograma`, quien,
      'El mismo trabajo visto como cronograma')
    await respirar(pagina, 4500)
    await salir(pagina)

    quien = 'Diseño e ingeniería'
    await entrar(pagina, 'diseno', quien, '4 · Diseño arranca la producción')
    await irA(pagina, `/ordenes/${estado.orden}?vista=cumplimiento`, quien,
      'Los planos que entregó: contra esto reportan Maestranza y Producción')
    await respirar(pagina, 4500)
    await irA(pagina, `/ordenes/${estado.orden}?vista=materiales`, quien,
      'El material que lleva la unidad, con lo pedido y lo que queda')
    await respirar(pagina, 5000)

    if (estado.requerimiento) {
      await irA(pagina, `/almacen/requerimientos/${estado.requerimiento}`, quien,
        'Y el requerimiento que salió de esa lista, esperando al almacén')
      await respirar(pagina, 5000)
    }
    await salir(pagina)
  },
}

// ---------------------------------------------------------------- arranque

if (!CLAVE) {
  console.error('Falta CLAVE')
  process.exit(2)
}

mkdirSync(SALIDA, { recursive: true })

const exe = NAVEGADORES.find((r) => existsSync(r))
if (!exe) throw new Error('No hay Chrome ni Edge en esta máquina')

const navegador = await chromium.launch({ executablePath: exe })
const contexto = await navegador.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: SALIDA, size: { width: 1440, height: 900 } },
  acceptDownloads: true,
})
const pagina = await contexto.newPage()
const video = pagina.video()

const errores = []
pagina.on('console', (m) => {
  if (m.type() === 'error') errores.push(m.text().slice(0, 160))
})

let fallo = null
try {
  const tramo = TRAMOS[TRAMO]
  if (!tramo) throw new Error(`No conozco el tramo «${TRAMO}». Hay: ${Object.keys(TRAMOS).join(', ')}`)
  console.log(`→ tramo ${TRAMO}`)
  await tramo(pagina)
  console.log(`✔ tramo ${TRAMO} terminado`)
} catch (error) {
  fallo = error
  console.error(`✗ tramo ${TRAMO}: ${error.message}`)
  await pagina.screenshot({ path: join(SALIDA, `fallo-${TRAMO}.png`) }).catch(() => {})
  console.error(`  (captura en fallo-${TRAMO}.png · url ${pagina.url()})`)
} finally {
  // El video se termina de escribir al cerrar el CONTEXTO, y se guarda con el
  // navegador todavía abierto: al revés, `saveAs` muere con «Target page,
  // context or browser has been closed» y el tramo se queda sin video aunque
  // haya ido bien.
  await contexto.close()
  if (video) {
    const destino = join(SALIDA, `tramo-${String(ORDEN[TRAMO] ?? 99).padStart(2, '0')}-${TRAMO}.webm`)
    await video
      .saveAs(destino)
      .then(() => console.log(`  video: ${destino}`))
      .catch((e) => console.log(`  (no se pudo guardar el video: ${e.message})`))
    await video.delete().catch(() => {})
  }
  await navegador.close()
}

if (errores.length) {
  console.log(`  ${errores.length} error(es) de consola:`)
  for (const e of [...new Set(errores)].slice(0, 5)) console.log(`   · ${e}`)
}


console.log(JSON.stringify(estado, null, 2))
process.exit(fallo ? 1 : 0)
