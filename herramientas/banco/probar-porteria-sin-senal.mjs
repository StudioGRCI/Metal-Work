/**
 * Recorre con clic real qué pasa cuando la portería marca sin señal (Plan 14,
 * entrega 14.2), con la cuenta de portería en el teléfono (390) y cortando la
 * red del navegador:
 *
 *   1. Sin red, la pantalla lo avisa arriba. Al tocar «Ingreso» la marca no
 *      entra y sube a «Sin confirmar», con su «Reintentar» y el cursor en él;
 *      la tarjeta dice «Ingreso sin confirmar» y apaga «Ingreso». Buscar a otra
 *      persona no la pierde. La pantalla sigue ahí (no sale la página sin
 *      conexión del navegador) y en el teléfono no se guarda nada: ni
 *      localStorage, ni sessionStorage, ni IndexedDB, ni la caché.
 *   2. Con la red de vuelta, «Reintentar» (tocado tres veces) deja una sola
 *      marca, con la hora que puso la base al llegar, no la del primer toque.
 *   3. La marca que entró pero cuya respuesta se perdió: la base tiene una
 *      fila, la pantalla dice que no se sabe; «Reintentar» manda el mismo
 *      envío, sigue habiendo una fila y la confirmación dice la hora de esa.
 *      Otra pantalla abierta desde antes que toca «Ingreso» con otro envío
 *      recibe «Ya tenía su ingreso de hoy» con esa hora, no un rojo.
 *   4. Esa misma, si la lista se pone al día antes de reintentar: el aviso se
 *      va solo. Anulada y vuelta a marcar, entra una marca nueva (no el «ya
 *      está» de la anulada).
 *   5. La base no da por marcada la salida que llega con el envío de otra
 *      marca: lo dice y no guarda nada. Tocar otra vez estrena otro envío y la
 *      salida entra.
 *   6. La búsqueda por DNI sin red lo dice y ofrece «Buscar otra vez»; un DNI
 *      que no es de nadie no la ofrece.
 *   7. Quien marca desde «Todos» sin buscar se queda donde está: la tarjeta no
 *      se corre bajo el dedo y, como la confirmación grande quedó fuera de la
 *      vista, la tarjeta dice «Ingreso marcado, HH:MM».
 *   8. La señal se va justo después de que la marca entra: no hay otra ida al
 *      servidor que pueda caer en la página sin conexión; la confirmación y la
 *      lista llegan con la respuesta.
 *   9. Lo que estaba sin confirmar y RR. HH. anuló entretanto: «Reintentar» no
 *      la marca otra vez y dice que entró, que se anuló y con qué motivo.
 *  11. «Anular» sin respuesta: al cerrar la ventana, la pantalla se pone al
 *      día y dice que la marca quedó anulada.
 *  12. La salida espera en «Sin confirmar» y RR. HH. anula el ingreso: el
 *      rechazo pone la lista al día y la tarjeta ya no muestra ese ingreso.
 *  10. Quien se va a otra pantalla con la marca en camino y la respuesta se pierde:
 *      arriba se dice que no se sabe si la marca quedó.
 *
 * Necesita las cuentas `*.local@metalwork.test` de portería y RR. HH. El
 * personal lo crea el script y lo da de baja al terminar. Variables:
 * BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS, BANCO_BASE, BANCO_CHROMIUM.
 */
import { existsSync, mkdirSync } from 'node:fs'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? ['/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].find((r) => existsSync(r))
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  porteria: process.env.PORTERIA ?? 'porteria.local@metalwork.test',
}
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const base = new pg.Client({
  host: process.env.PGHOST ?? '/tmp',
  port: Number(process.env.PGPORT ?? 5433),
  user: process.env.PGUSER ?? 'postgres',
  database: process.env.BANCO_BASE ?? 'mw_demo',
})
await base.connect()
const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

// ------------------------------------------------ los datos de la prueba
const sello = Date.now().toString().slice(-6)
const persona = (nombre, n, prefijo = '7', apellidos = 'Prueba Señal') => ({ id: crypto.randomUUID(), nombres: `${nombre} ${sello}`, apellidos, dni: `${prefijo}${sello}${n}` })
const ana = persona('Ana', 1)
const beto = persona('Beto', 2)
const carla = persona('Carla', 3)
const dana = persona('Dana', 4)
// Relleno para que la lista de «Todos» pase de una pantalla; por el apellido va
// primero, a la vista con la página arriba.
const relleno = Array.from({ length: 8 }, (_, i) => persona(`Relleno${i}`, i, '8', 'Aaa Relleno'))
const todos = [ana, beto, carla, dana, ...relleno]

const [{ id: rrhhId }] = await consulta('select id from public.usuarios where correo = $1', [CUENTAS.rrhh])
await base.query('begin')
await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
await base.query('set local role authenticated')
for (const p of todos) {
  await base.query(
    `select public.rrhh_guardar_trabajador($1, $2, $3, $4, 'Soldador', null, '23:58', '23:59', 'Banco de Pruebas', 'AHORROS', $5, null)`,
    [p.id, p.nombres, p.apellidos, p.dni, `191-${p.dni}`],
  )
}
await base.query('commit')

const marcasDe = (p) =>
  consulta(
    `select id, tipo, to_char(hora, 'HH24:MI') as hora, to_char(hora, 'HH24:MI:SS') as hora_larga, anulado_en is not null as anulada
       from public.asistencias where trabajador_id = $1 and fecha = (now() at time zone 'America/Lima')::date order by marcado_en`,
    [p.id],
  )

// ------------------------------------------------ el navegador
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const contexto = await navegador.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
const pagina = await contexto.newPage()
const errores = []
pagina.on('pageerror', (e) => errores.push(e.message.slice(0, 300)))

const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()
const tarjetaEn = (pag, p) => pag.locator('main li:not([data-pendiente-de])').filter({ hasText: p.nombres }).first()
const tarjetaDe = (p) => tarjetaEn(pagina, p)
const confirmacion = pagina.locator('[data-confirmacion-de-marca]')
const sinSenal = pagina.locator('[data-sin-senal]')
const sinConfirmar = pagina.locator('[data-sin-confirmar]')
const enDuda = (p) => pagina.locator(`[data-pendiente-de="${p.id}"]`)
const buscar = (texto) => pagina.getByRole('searchbox').fill(texto)

/**
 * Deja pasar al servidor el próximo envío de una marca y le corta la respuesta
 * al navegador: la marca entra y la pantalla no se entera.
 */
async function perderLaRespuestaDelProximoEnvio(pag = pagina, { espera = 0 } = {}) {
  let armado = true
  await pag.route('**/rrhh/asistencia*', async (ruta) => {
    const pedido = ruta.request()
    if (!armado || pedido.method() !== 'POST' || !pedido.headers()['next-action']) return ruta.fallback()
    armado = false
    await ruta.fetch().catch(() => {})
    if (espera) await new Promise((listo) => setTimeout(listo, espera))
    await ruta.abort('connectionreset')
  })
}

try {
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', CUENTAS.porteria)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }), pagina.click('button[type="submit"]')])
  await pagina.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })

  // ---------------------------------------------- 1. sin red
  console.log('\n1. Sin red: lo dice, no marca y no guarda nada en el teléfono')
  await buscar(`Señal ${ana.nombres}`)
  await tarjetaDe(ana).waitFor({ timeout: 15000 })
  comprobar(limpio(await sinSenal.textContent()) === '', 'con red, el aviso de «sin señal» está callado')
  await contexto.setOffline(true)
  await sinSenal.getByText('sin señal').waitFor({ timeout: 10000 })
  console.log(`     arriba: «${limpio(await sinSenal.innerText())}»`)
  comprobar(/no se guardan en el equipo/.test(await sinSenal.innerText()), 'arriba dice que está sin señal y que las marcas no se guardan en el equipo')
  const horaDelToque = (await consulta(`select to_char(now() at time zone 'America/Lima', 'HH24:MI:SS') as h`))[0].h
  await tarjetaDe(ana).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await enDuda(ana).waitFor({ timeout: 20000 })
  const aviso = limpio(await sinConfirmar.innerText())
  console.log(`     arriba: «${aviso}»`)
  comprobar(/Sin confirmar \(1\)/.test(aviso) && /No llegó la respuesta/.test(aviso) && /ingreso sin confirmar/.test(aviso), '«Sin confirmar» dice en claro que no llegó la respuesta del ingreso de Ana')
  comprobar(
    (await enDuda(ana).getByRole('button', { name: `Reintentar el ingreso de ${ana.nombres} ${ana.apellidos}` }).count()) === 1 && /no se marca dos veces/.test(aviso),
    'ofrece «Reintentar» (que dice de quién al lector) y dice que no se marca dos veces',
  )
  comprobar(
    await pagina.evaluate(() => /Reintentar/.test(document.activeElement?.textContent ?? '')),
    `el cursor quedó en «Reintentar» (está en: «${await pagina.evaluate(() => (document.activeElement?.textContent ?? document.activeElement?.tagName ?? '').trim().slice(0, 40))}»)`,
  )
  const tarjetaAna = limpio(await tarjetaDe(ana).innerText())
  comprobar(/Ingreso sin confirmar/.test(tarjetaAna) && !/Sin ingreso/.test(tarjetaAna), 'la tarjeta dice «Ingreso sin confirmar», no «Sin ingreso»')
  comprobar(await tarjetaDe(ana).getByRole('button', { name: /Marcar el ingreso/ }).isDisabled(), 'y su «Ingreso» queda apagado: se reintenta arriba, con el mismo envío')
  comprobar((await tarjetaDe(ana).getByRole('alert').count()) === 0, 'sin un rojo en la tarjeta')
  comprobar((await marcasDe(ana)).length === 0, 'en la base no hay ninguna marca de Ana')
  comprobar(limpio(await confirmacion.textContent()) === '', 'no hay confirmación de una marca que no entró')
  comprobar((await pagina.getByRole('heading', { name: 'Asistencia de hoy' }).count()) === 1, 'la pantalla sigue ahí: no salió la página sin conexión del navegador')
  // Lo que haya en el teléfono se lee entero: una base de IndexedDB que no
  // nombra a la persona ni la marca no es la marca guardada (en `next dev` hay
  // una de las herramientas de Next).
  const guardado = await pagina.evaluate(async (ids) => {
    const partes = [JSON.stringify({ ...localStorage }), JSON.stringify({ ...sessionStorage })]
    const bases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : []
    for (const { name } of bases) {
      const db = await new Promise((listo, fallo) => {
        const pedido = indexedDB.open(name)
        pedido.onsuccess = () => listo(pedido.result)
        pedido.onerror = () => fallo(pedido.error)
      })
      for (const almacen of db.objectStoreNames) {
        const filas = await new Promise((listo) => {
          const pedido = db.transaction(almacen).objectStore(almacen).getAll()
          pedido.onsuccess = () => listo(pedido.result)
          pedido.onerror = () => listo([])
        })
        partes.push(JSON.stringify(filas))
      }
      db.close()
    }
    const caches_ = 'caches' in window ? await caches.keys() : []
    const texto = partes.join(' ')
    return { conPersona: ids.some((id) => texto.includes(id)), conMarca: /INGRESO|marca_id/.test(texto), bases: bases.map((b) => b.name), caches: caches_.length }
  }, todos.map((p) => p.id))
  comprobar(
    !guardado.conPersona && !guardado.conMarca && guardado.caches === 0,
    `el teléfono no guardó la marca: ni localStorage, ni sessionStorage, ni IndexedDB (${guardado.bases.join(', ') || 'vacía'}), ni caché`,
  )
  const alto = await enDuda(ana).getByRole('button', { name: /Reintentar/ }).evaluate((e) => e.getBoundingClientRect().height)
  comprobar(alto >= 44, `«Reintentar» mide ${Math.round(alto)} px de alto`)
  await enDuda(ana).scrollIntoViewIfNeeded()
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-1-no-llego.png` })

  // Sigue sin red: reintentar no cambia nada.
  await enDuda(ana).getByRole('button', { name: /Reintentar/ }).click()
  await enDuda(ana).getByText('Tampoco llegó la respuesta').waitFor({ timeout: 20000 })
  comprobar((await marcasDe(ana)).length === 0, 'reintentar sin red tampoco marca, y lo dice: «Tampoco llegó la respuesta esta vez»')
  // Buscar a otra persona no pierde lo que quedó sin confirmar.
  await buscar(`Señal ${beto.nombres}`)
  await tarjetaDe(beto).waitFor({ timeout: 15000 })
  comprobar((await enDuda(ana).count()) === 1 && (await tarjetaDe(ana).count()) === 0, 'buscando a Beto, el ingreso de Ana sigue arriba en «Sin confirmar»')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-1b-buscando-a-otro.png` })

  // ---------------------------------------------- 2. vuelve la red
  console.log('\n2. Vuelve la red: «Reintentar» marca una sola vez, con la hora de la base')
  await pagina.waitForTimeout(1200) // para que la hora de la base sea otra que la del primer toque
  await contexto.setOffline(false)
  // Se vuelve a Ana: la confirmación se da con lo que se buscaba al marcar.
  await buscar(`Señal ${ana.nombres}`)
  await pagina.waitForFunction(() => !document.querySelector('[data-sin-senal]')?.textContent?.trim(), null, { timeout: 10000 })
  comprobar(true, 'con la red de vuelta, el aviso de arriba se calla')
  const reintentar = enDuda(ana).getByRole('button', { name: /Reintentar/ })
  await reintentar.click()
  await reintentar.click({ force: true, timeout: 1500 }).catch(() => {})
  await reintentar.click({ force: true, timeout: 1500 }).catch(() => {})
  await confirmacion.getByText('Ingreso marcado').waitFor({ timeout: 20000 })
  let filas = await marcasDe(ana)
  let dicho = limpio(await confirmacion.innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(filas.length === 1, `tres toques en «Reintentar» dejan una sola marca (hay ${filas.length})`)
  comprobar(dicho.includes(ana.nombres) && dicho.includes(filas[0]?.hora), `la confirmación dice la hora de la base (${filas[0]?.hora})`)
  comprobar(filas[0]?.hora_larga > horaDelToque, `la hora es la de cuando llegó (${filas[0]?.hora_larga}), no la del toque sin red (${horaDelToque})`)
  comprobar((await enDuda(ana).count()) === 0 && (await sinConfirmar.count()) === 0, '«Sin confirmar» se fue')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-2-reintento-entro.png` })

  // ---------------------------------------------- 3. entró y se perdió la respuesta
  console.log('\n3. La marca entró pero la respuesta se perdió: reintentar no la duplica')
  await buscar(`Señal ${beto.nombres}`)
  await tarjetaDe(beto).waitFor({ timeout: 15000 })
  comprobar(/^Último: ingreso de .*Ana/.test(limpio(await confirmacion.innerText())), 'buscando al siguiente, la confirmación de Ana se achica a una línea')
  // Otro teléfono de la portería, con la pantalla de antes de que Beto marque.
  const otra = await contexto.newPage()
  otra.on('pageerror', (e) => errores.push(e.message.slice(0, 300)))
  await otra.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  await otra.getByRole('searchbox').fill(`Señal ${beto.nombres}`)
  await tarjetaEn(otra, beto).waitFor({ timeout: 15000 })
  await pagina.bringToFront()
  await perderLaRespuestaDelProximoEnvio()
  await tarjetaDe(beto).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await enDuda(beto).waitFor({ timeout: 20000 })
  filas = await marcasDe(beto)
  comprobar(filas.length === 1, `la base ya tiene la marca de Beto (${filas.length}) y la pantalla dice que no se sabe`)
  const primera = filas[0]
  await pagina.waitForTimeout(1200)
  await enDuda(beto).getByRole('button', { name: /Reintentar/ }).click()
  await confirmacion.getByText(beto.nombres).waitFor({ timeout: 20000 })
  filas = await marcasDe(beto)
  dicho = limpio(await confirmacion.innerText())
  console.log(`     confirmación: «${dicho}»`)
  comprobar(filas.length === 1 && filas[0].id === primera?.id && filas[0].hora_larga === primera?.hora_larga, 'sigue habiendo una sola marca, la misma, con su hora de antes')
  comprobar(dicho.includes('Ingreso marcado') && dicho.includes(primera?.hora), 'la confirmación dice esa marca y su hora')

  await otra.bringToFront()
  await tarjetaEn(otra, beto).getByRole('button', { name: /Marcar el ingreso/ }).click()
  const deLaOtra = otra.locator('[data-confirmacion-de-marca]')
  await deLaOtra.getByText('Ya tenía su ingreso de hoy').waitFor({ timeout: 20000 })
  const dichoOtra = limpio(await deLaOtra.innerText())
  console.log(`     la otra pantalla: «${dichoOtra}»`)
  comprobar(dichoOtra.includes(primera?.hora) && (await marcasDe(beto)).length === 1, 'la otra pantalla dice «Ya tenía su ingreso de hoy» con su hora, y sigue habiendo una marca')
  comprobar((await tarjetaEn(otra, beto).getByRole('alert').count()) === 0, 'sin un rojo en su tarjeta')
  await otra.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-4-ya-tenia.png` })
  await otra.close()
  await pagina.bringToFront()

  // ---------------------------------------------- 4. la lista se pone al día antes de reintentar
  console.log('\n4. Entró sin respuesta y la lista se pone al día: el aviso se va; anulada, se vuelve a marcar de verdad')
  await buscar('Prueba Señal')
  await tarjetaDe(carla).waitFor({ timeout: 15000 })
  await perderLaRespuestaDelProximoEnvio()
  await tarjetaDe(carla).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await enDuda(carla).waitFor({ timeout: 20000 })
  comprobar((await marcasDe(carla)).length === 1, 'la marca de Carla entró y su tarjeta está en duda')
  // La marca de otra persona pone la lista al día.
  await tarjetaDe(dana).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await confirmacion.getByText(dana.nombres).waitFor({ timeout: 20000 })
  await tarjetaDe(carla).getByText(/Ingreso \d\d:\d\d/).waitFor({ timeout: 20000 })
  const yaSeSabe = limpio(await enDuda(carla).innerText())
  console.log(`     arriba: «${yaSeSabe}»`)
  comprobar(/Sí entró: el ingreso de Carla .* quedó a las \d\d:\d\d/.test(yaSeSabe) && (await enDuda(carla).getByRole('button', { name: /Reintentar/ }).count()) === 0,
    'con la lista al día, arriba dice «Sí entró» con su hora y ya no pide reintentar')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-5-si-entro.png` })
  await enDuda(carla).getByRole('button', { name: 'Entendido' }).click()
  comprobar((await enDuda(carla).count()) === 0 && (await sinConfirmar.count()) === 0, '«Entendido» lo quita')
  comprobar((await tarjetaDe(carla).getByRole('alert').count()) === 0, 'ni queda otro aviso rojo en su tarjeta')
  await tarjetaDe(carla).getByRole('button', { name: /^Anular el ingreso/ }).click()
  const ventana = pagina.getByRole('dialog')
  await ventana.getByLabel('Motivo').fill(`Prueba de señal ${sello}: no era ella`)
  await ventana.getByRole('button', { name: 'Anular', exact: true }).click()
  await tarjetaDe(carla).getByText('Sin ingreso').waitFor({ timeout: 20000 })
  await tarjetaDe(carla).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await confirmacion.getByText(carla.nombres).waitFor({ timeout: 20000 })
  filas = await marcasDe(carla)
  comprobar(filas.length === 2 && filas[0].anulada && !filas[1].anulada && filas[0].id !== filas[1].id, `vuelta a marcar, hay una marca nueva vigente además de la anulada (${filas.length} filas)`)

  // ---------------------------------------------- 5. la guarda de la base
  console.log('\n5. La base no da por marcada la salida que llega con el envío de otra marca')
  const [ingresoDana] = await marcasDe(dana)
  // Como si la pantalla hubiera conservado el id del ingreso para la salida.
  // Con la lista ya al día: React vuelve a poner el valor del campo al repintar.
  await pagina.waitForLoadState('networkidle')
  await pagina.waitForTimeout(800)
  await tarjetaDe(dana).locator('form input[name="tipo"][value="SALIDA"]').evaluate((campo, id) => {
    campo.form.querySelector('input[name="marca_id"]').value = id
  }, ingresoDana.id)
  await tarjetaDe(dana).getByRole('button', { name: /Marcar la salida/ }).click()
  const rechazo = tarjetaDe(dana).getByRole('alert')
  await rechazo.waitFor({ timeout: 20000 })
  console.log(`     tarjeta: «${limpio(await rechazo.innerText())}»`)
  comprobar(/como el ingreso de Dana .*esta no entró/.test(await rechazo.innerText()), 'dice que ese envío ya fue el ingreso de Dana y que esta marca no entró')
  comprobar((await marcasDe(dana)).filter((m) => m.tipo === 'SALIDA').length === 0, 'y en la base no hay ninguna salida de Dana')
  comprobar(!limpio(await confirmacion.innerText()).includes('Salida marcada'), 'la confirmación no dice «Salida marcada»')
  comprobar((await sinConfirmar.count()) === 0, 'y no la deja en «Sin confirmar»: no hay duda')
  // El envío rechazado ya no sirve: el toque siguiente lleva otro, y entra.
  await tarjetaDe(dana).getByRole('button', { name: /Marcar la salida/ }).click()
  await confirmacion.getByText('Salida marcada').waitFor({ timeout: 20000 })
  comprobar((await marcasDe(dana)).filter((m) => m.tipo === 'SALIDA').length === 1, 'tocar otra vez estrena otro envío: la salida de Dana entra, una vez')

  // ---------------------------------------------- 6. el DNI sin red
  console.log('\n6. La búsqueda por DNI sin red lo dice y se puede repetir')
  await contexto.setOffline(true)
  await buscar(ana.dni)
  const otraVez = pagina.getByRole('button', { name: 'Buscar otra vez' })
  await otraVez.waitFor({ timeout: 20000 })
  const vacio = limpio(await pagina.locator('main [role="status"]').filter({ hasText: 'No se pudo buscar' }).innerText())
  console.log(`     lista: «${vacio}»`)
  comprobar(/no llegó la respuesta/.test(vacio), 'dice que no se pudo buscar porque no llegó la respuesta')
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-3-dni-sin-red.png` })
  await contexto.setOffline(false)
  await otraVez.click()
  await tarjetaDe(ana).waitFor({ timeout: 20000 })
  comprobar((await pagina.locator('main li:not([data-pendiente-de])').count()) === 1, 'con la red de vuelta, «Buscar otra vez» trae la tarjeta de ese DNI')
  comprobar(!(await pagina.content()).includes(`191-${ana.dni}`), 'y sigue sin llegar ninguna cuenta bancaria')
  await buscar('09999999')
  await pagina.getByText('Ese DNI no es de nadie del personal activo').waitFor({ timeout: 20000 })
  comprobar((await otraVez.count()) === 0, 'un DNI que no es de nadie no ofrece «Buscar otra vez»: no hay nada que repetir')

  // ---------------------------------------------- 7. marcar desde «Todos» sin buscar
  console.log('\n7. Desde «Todos» sin buscar: la tarjeta no se corre y dice que entró')
  const tercera = await contexto.newPage()
  tercera.on('pageerror', (e) => errores.push(e.message.slice(0, 300)))
  await tercera.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  // La primera, con la página arriba: la confirmación nace encima de la lista.
  const aLaVista = async () => {
    for (const p of relleno) {
      const t = tarjetaEn(tercera, p)
      const r = await t.boundingBox()
      if (r && r.y >= 60 && r.y + r.height <= 844 && !(await t.getByRole('button', { name: /Marcar el ingreso/ }).isDisabled())) return { p, t, y: r.y }
    }
    return null
  }
  for (const vuelta of ['con la página arriba', 'con la lista bajada']) {
    if (vuelta === 'con la lista bajada') await tercera.evaluate(() => window.scrollBy(0, 300))
    const elegida = await aLaVista()
    if (!elegida) {
      comprobar(false, `${vuelta}: no hubo una tarjeta de relleno a la vista`)
      continue
    }
    const scrollAntes = await tercera.evaluate(() => window.scrollY)
    await elegida.t.getByRole('button', { name: /Marcar el ingreso/ }).click()
    await elegida.t.getByText(/Ingreso marcado, \d\d:\d\d\./).waitFor({ timeout: 20000 })
    const despues = (await elegida.t.boundingBox())?.y ?? -1
    console.log(`     ${vuelta}: tarjeta en y=${Math.round(elegida.y)} → y=${Math.round(despues)} (scroll ${scrollAntes} → ${await tercera.evaluate(() => window.scrollY)})`)
    comprobar(Math.abs(despues - elegida.y) <= 2, `${vuelta}: la tarjeta de ${elegida.p.nombres} no se corrió bajo el dedo`)
    comprobar(true, `${vuelta}: la tarjeta dice «Ingreso marcado, HH:MM.», porque la confirmación grande no está a la vista`)
    comprobar((await marcasDe(elegida.p)).length === 1, `${vuelta}: una marca en la base`)
  }
  await tercera.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-6-desde-todos.png` })

  // ---------------------------------------------- 8. la señal se va justo después del ok
  console.log('\n8. La señal se va justo después de que la marca entra')
  const [r8, r9] = relleno.slice(-2)
  await tercera.getByRole('searchbox').fill(`Relleno ${r8.nombres}`.replace(/^Relleno /, ''))
  await tarjetaEn(tercera, r8).waitFor({ timeout: 15000 })
  // Después de la acción, cualquier ida a pedir la pantalla se corta: la señal ya se fue.
  let cortadas = 0
  let accionVolvio = false
  await tercera.route('**/*', async (ruta) => {
    const pedido = ruta.request()
    if (pedido.method() === 'POST' && pedido.headers()['next-action']) {
      const respuesta = await ruta.fetch()
      accionVolvio = true
      return ruta.fulfill({ response: respuesta })
    }
    // Una ida a pedir la pantalla: el árbol de Next (`_rsc`) o la página entera.
    const pidePantalla = /[?&]_rsc=/.test(pedido.url()) || pedido.headers()['rsc'] === '1' || pedido.resourceType() === 'document'
    if (accionVolvio && pedido.method() === 'GET' && pidePantalla) {
      cortadas += 1
      console.log(`     cortada: ${pedido.url().replace(BASE, '')}`)
      return ruta.abort('internetdisconnected')
    }
    return ruta.fallback()
  })
  await tarjetaEn(tercera, r8).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await tercera.locator('[data-confirmacion-de-marca]').getByText('Ingreso marcado').waitFor({ timeout: 20000 })
  await tarjetaEn(tercera, r8).getByText(/Ingreso \d\d:\d\d/).waitFor({ timeout: 20000 })
  await tercera.waitForTimeout(1500)
  console.log(`     idas cortadas después del ok: ${cortadas}`)
  comprobar(cortadas === 0, 'después del ok no sale otra ida al servidor: la respuesta ya trae la lista')
  comprobar(
    (await tercera.getByRole('heading', { name: 'Asistencia de hoy' }).count()) === 1 && (await marcasDe(r8)).length === 1,
    'la pantalla sigue ahí, con la confirmación y la tarjeta al día, y hay una marca',
  )
  await tercera.unroute('**/*')

  // ---------------------------------------------- 9. sin confirmar y anulada por RR. HH.
  console.log('\n9. Sin confirmar, y RR. HH. la anula antes del reintento')
  await tercera.getByRole('searchbox').fill(r9.nombres)
  await tarjetaEn(tercera, r9).waitFor({ timeout: 15000 })
  await perderLaRespuestaDelProximoEnvio(tercera)
  await tarjetaEn(tercera, r9).getByRole('button', { name: /Marcar el ingreso/ }).click()
  const pendiente9 = tercera.locator(`[data-pendiente-de="${r9.id}"]`)
  await pendiente9.getByRole('button', { name: /Reintentar/ }).waitFor({ timeout: 20000 })
  const [marca9] = await marcasDe(r9)
  const motivo9 = `RR. HH. corrige ${sello}: no vino`
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
  await base.query('set local role authenticated')
  await base.query('select public.anular_asistencia($1, $2)', [marca9.id, motivo9])
  await base.query('commit')
  await pendiente9.getByRole('button', { name: /Reintentar/ }).click()
  await pendiente9.getByText('Sí entró').waitFor({ timeout: 20000 })
  const dicho9 = limpio(await pendiente9.innerText())
  console.log(`     arriba: «${dicho9}»`)
  comprobar(/después se anuló/.test(dicho9) && dicho9.includes(motivo9), 'dice que entró, que después se anuló y con qué motivo')
  const filas9 = await marcasDe(r9)
  comprobar(filas9.length === 1 && filas9[0].anulada, 'y no la marca otra vez: sigue una sola, anulada por RR. HH.')
  comprobar(!/sin confirmar/i.test(limpio(await tarjetaEn(tercera, r9).innerText())), 'la tarjeta ya no dice «sin confirmar»')
  await tercera.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-7-anulada-por-rrhh.png` })
  await pendiente9.getByRole('button', { name: 'Entendido' }).click()
  comprobar(await tercera.evaluate(() => document.activeElement?.getAttribute('type') === 'search'), '«Entendido» deja el cursor en el buscador')

  // ---------------------------------------------- 10. se va con la marca en camino
  console.log('\n10. Se va a otra pantalla con la marca en camino y la respuesta se pierde')
  const libres = []
  for (const p of relleno.slice(0, 6)) if ((await marcasDe(p)).length === 0) libres.push(p)
  const p10 = libres[0] ?? relleno[0]
  await tercera.getByRole('searchbox').fill(p10.nombres)
  await tarjetaEn(tercera, p10).waitFor({ timeout: 15000 })
  await perderLaRespuestaDelProximoEnvio(tercera, { espera: 2500 })
  await tarjetaEn(tercera, p10).getByRole('button', { name: /Marcar el ingreso/ }).click()
  // Al Dashboard, por el menú de abajo: la ida es de la aplicación, no del navegador.
  await tercera.getByRole('link', { name: 'Dashboard' }).first().click()
  await tercera.waitForURL((u) => !u.pathname.startsWith('/rrhh/asistencia'), { timeout: 20000 })
  const linea = tercera.getByText(new RegExp(`No se sabe si la marca de ${p10.nombres}`))
  await linea.waitFor({ timeout: 20000 })
  console.log(`     arriba: «${limpio(await linea.innerText()).slice(0, 160)}»`)
  comprobar(true, 'en la otra pantalla, arriba dice que no se sabe si la marca quedó')
  comprobar((await marcasDe(p10)).length === 1, 'y la marca sí estaba en la base (se perdió solo la respuesta)')
  await tercera.screenshot({ path: `${CAPTURAS}/porteria-390-sin-senal-8-se-fue.png` })
  // De vuelta en Asistencia, la lista trae la marca: la línea ya no vale y se va.
  await tercera.getByRole('link', { name: 'Volver a Asistencia' }).first().click()
  await tercera.waitForURL(/\/rrhh\/asistencia/, { timeout: 20000 })
  await tercera.getByRole('heading', { name: 'Asistencia de hoy' }).waitFor({ timeout: 20000 })
  await tercera.waitForTimeout(800)
  comprobar((await linea.count()) === 0, 'de vuelta en Asistencia, con la marca en la lista, la línea de arriba se va')
  await tercera.close()

  // ---------------------------------------------- 11. anular sin respuesta
  console.log('\n11. «Anular» sin respuesta: al cerrar la ventana, la pantalla se pone al día')
  const libres11 = []
  for (const p of relleno.slice(0, 6)) if ((await marcasDe(p)).length === 0) libres11.push(p)
  const [p11, p12] = libres11
  const quinta = await contexto.newPage()
  quinta.on('pageerror', (e) => errores.push(e.message.slice(0, 300)))
  await quinta.goto(`${BASE}/rrhh/asistencia`, { waitUntil: 'networkidle' })
  await quinta.getByRole('searchbox').fill(p11.nombres)
  await tarjetaEn(quinta, p11).getByRole('button', { name: /Marcar el ingreso/ }).click()
  const conf5 = quinta.locator('[data-confirmacion-de-marca]')
  await conf5.getByText('Ingreso marcado').waitFor({ timeout: 20000 })
  await conf5.getByRole('button', { name: 'Anular esta marca' }).click()
  const ventana11 = quinta.getByRole('dialog')
  await ventana11.getByLabel('Motivo').fill(`Prueba ${sello}: se marcó a quien no era`)
  await perderLaRespuestaDelProximoEnvio(quinta)
  await ventana11.getByRole('button', { name: 'Anular', exact: true }).click()
  await ventana11.getByText(/No llegó la respuesta|no se sabe/i).first().waitFor({ timeout: 20000 })
  comprobar((await marcasDe(p11))[0]?.anulada === true, 'la base ya la tiene anulada, aunque la respuesta no llegó')
  await ventana11.getByRole('button', { name: 'Cancelar' }).click()
  await conf5.getByText('Ingreso anulado').waitFor({ timeout: 20000 })
  comprobar(true, 'al cerrar la ventana, la confirmación pasa a «Ingreso anulado» con la lista al día')
  comprobar((await conf5.getByRole('button', { name: 'Anular esta marca' }).count()) === 0, 'y ya no ofrece anularla otra vez')

  // ---------------------------------------------- 12. la salida espera y RR. HH. anula el ingreso
  console.log('\n12. La salida espera en «Sin confirmar» y RR. HH. anula el ingreso')
  await quinta.getByRole('searchbox').fill(p12.nombres)
  await tarjetaEn(quinta, p12).getByRole('button', { name: /Marcar el ingreso/ }).click()
  await conf5.getByText(p12.nombres).waitFor({ timeout: 20000 })
  await tarjetaEn(quinta, p12).getByText(/Ingreso \d\d:\d\d/).waitFor({ timeout: 20000 })
  await contexto.setOffline(true)
  await tarjetaEn(quinta, p12).getByRole('button', { name: /Marcar la salida/ }).click()
  const pendiente12 = quinta.locator(`[data-pendiente-de="${p12.id}"]`)
  await pendiente12.getByRole('button', { name: /Reintentar/ }).waitFor({ timeout: 20000 })
  const [ingreso12] = await marcasDe(p12)
  await base.query('begin')
  await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
  await base.query('set local role authenticated')
  await base.query('select public.anular_asistencia($1, $2)', [ingreso12.id, `RR. HH. corrige ${sello}: no vino`])
  await base.query('commit')
  await contexto.setOffline(false)
  await pendiente12.getByRole('button', { name: /Reintentar/ }).click()
  await pendiente12.getByText(/marca primero el ingreso/).waitFor({ timeout: 20000 })
  await tarjetaEn(quinta, p12).getByText('Sin ingreso').waitFor({ timeout: 20000 })
  const tarjeta12 = limpio(await tarjetaEn(quinta, p12).innerText())
  console.log(`     tarjeta: «${tarjeta12.slice(0, 140)}»`)
  comprobar(/anulada: RR\. HH\. corrige/.test(tarjeta12), 'el rechazo puso la lista al día: la tarjeta dice «Sin ingreso» y el ingreso anulado con su motivo')
  comprobar(!(await tarjetaEn(quinta, p12).getByRole('button', { name: /Marcar el ingreso/ }).isDisabled()), 'y vuelve a ofrecer «Ingreso»')
  comprobar((await marcasDe(p12)).filter((m) => m.tipo === 'SALIDA').length === 0, 'en la base no hay salida')
  await quinta.close()

  comprobar(errores.length === 0, `sin errores de la página${errores.length ? `: ${errores[0]}` : ''}`)
} catch (e) {
  fallas.push(`se cortó: ${e.message.split('\n')[0]}`)
  console.error(e)
  await pagina.screenshot({ path: `${CAPTURAS}/porteria-sin-senal-donde-se-corto.png` }).catch(() => {})
} finally {
  await navegador.close()
  // Si no se pudo dar de baja, que se sepa: quedaría personal de prueba en la lista.
  // Como RR. HH., con su fecha de baja, como lo haría la pantalla de Personal.
  try {
    await base.query('begin')
    await base.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true)`, [rrhhId])
    await base.query('set local role authenticated')
    for (const id of todos.map((p) => p.id)) {
      const [{ activo }] = await consulta('select activo from public.trabajadores where id = $1', [id])
      if (activo) await base.query(`select public.rrhh_dar_de_baja_trabajador($1, (now() at time zone 'America/Lima')::date)`, [id])
    }
    await base.query('commit')
  } catch (e) {
    await base.query('rollback').catch(() => {})
    fallas.push(`no se pudo dar de baja al personal de prueba: ${e.message}`)
  }
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} FALLAS:\n- ${fallas.join('\n- ')}` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
