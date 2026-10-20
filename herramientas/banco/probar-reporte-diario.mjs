/**
 * Recorre con clic real el reporte diario de supervisión, con la cuenta de
 * cada puesto (nunca ADMIN):
 *
 *   1. El supervisor de Maestranza, en tamaño de celular, sube un reporte con
 *      dos trabajos, su avance y su gente (una persona sin costo mensual) y dos
 *      fotos grandes que se achican antes de subir; un archivo que no es foto
 *      no entra. Tres toques dan un solo reporte.
 *   2. Sube un segundo reporte con «Personal general»: si una persona pasa de
 *      16 horas en el día, la base lo rechaza y lo escrito no se pierde.
 *   3. El supervisor de Acabados no ve los reportes de Maestranza ni por URL.
 *   4. RR. HH. ve en el reporte qué horas están en el costeo y cuáles esperan
 *      su costo, las ve en el costeo con el enlace al reporte, le pone su costo
 *      a la persona que faltaba y sus horas entran solas.
 *   5. Gerencia consulta los reportes sin botón de anular ni costeo.
 *   6. La portería no entra.
 *   7. El supervisor anula su segundo reporte con motivo y sus horas salen del
 *      costeo.
 *
 * Necesita en la base del banco las cuentas `*.local@metalwork.test` de cada
 * puesto (supervisores con su área). El personal lo crea el script, inventado
 * y distinto en cada corrida, para no depender de lo que dejó la anterior.
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  mtz: process.env.SUPERVISOR_MTZ ?? 'sup.mtz.local@metalwork.test',
  acb: process.env.SUPERVISOR_ACB ?? 'sup.acb.local@metalwork.test',
  rrhh: process.env.RRHH ?? 'rrhh.local@metalwork.test',
  gerencia: process.env.GERENCIA ?? 'gerencia.local@metalwork.test',
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
const limpio = (t) => (t ?? '').replace(/\s+/g, ' ').trim()

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const CELULAR = { width: 390, height: 844 }

async function entrar(correo, viewport = { width: 1280, height: 900 }) {
  const contexto = await navegador.newContext({ viewport, isMobile: viewport.width < 500, hasTouch: viewport.width < 500, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, 300))
  })
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', correo)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${correo}`)
  return { pagina, contexto, errores }
}

/** Elige a una persona en el `SeleccionBuscable` cuyo nombre accesible se da. */
async function elegirPersona(pagina, etiqueta, texto) {
  await pagina.getByRole('combobox', { name: etiqueta }).click()
  await pagina.keyboard.type(texto)
  await pagina.getByRole('option', { name: new RegExp(texto) }).first().click()
}

// --------------------------------------------------- fotos de prueba
// Ruido para que la foto pese de verdad (una foto de celular, varios MB) y
// tenga que achicarse; una PNG lisa; y un «.jpg» que no es imagen.
const fotos = join(CAPTURAS, 'fotos-reporte')
mkdirSync(fotos, { recursive: true })
{
  const p = await (await navegador.newContext()).newPage()
  const hacer = (ancho, alto, tipo, ruido) =>
    p.evaluate(
      async ([ancho, alto, tipo, ruido]) => {
        const c = document.createElement('canvas')
        c.width = ancho
        c.height = alto
        const g = c.getContext('2d')
        if (ruido) {
          const img = g.createImageData(ancho, alto)
          for (let i = 0; i < img.data.length; i++) img.data[i] = (i + 1) % 4 === 0 ? 255 : Math.random() * 255
          g.putImageData(img, 0, 0)
        } else {
          const d = g.createLinearGradient(0, 0, ancho, alto)
          d.addColorStop(0, '#7a4b2a')
          d.addColorStop(1, '#3a3f44')
          g.fillStyle = d
          g.fillRect(0, 0, ancho, alto)
        }
        const blob = await new Promise((r) => c.toBlob(r, tipo, 0.95))
        const b = new Uint8Array(await blob.arrayBuffer())
        let s = ''
        for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
        return btoa(s)
      },
      [ancho, alto, tipo, ruido],
    )
  writeFileSync(join(fotos, 'tolva-grande.jpg'), Buffer.from(await hacer(3000, 2200, 'image/jpeg', true), 'base64'))
  writeFileSync(join(fotos, 'chasis.png'), Buffer.from(await hacer(1800, 1200, 'image/png', false), 'base64'))
  writeFileSync(join(fotos, 'no-es-foto.jpg'), 'esto no es una imagen')
  await p.context().close()
}
const pesoGrande = (await import('node:fs')).statSync(join(fotos, 'tolva-grande.jpg')).size
console.log(`  · foto grande de prueba: ${(pesoGrande / 1024 / 1024).toFixed(1)} MB`)

const sello = Date.now().toString().slice(-5)
const codigo = `PRB_SR_O4_1_26/${sello.slice(-2)}`
const asunto1 = `Armado de tolva ${sello}`
const asunto2 = `Planta general ${sello}`
const [ana, bruno, carlos] = [`Ana ${sello}`, `Bruno ${sello}`, `Carlos ${sello}`]

// El personal de Maestranza, como lo dejaría RR. HH.: Ana y Bruno con su costo
// mensual (S/ 2,400 y S/ 1,920: S/ 10 y S/ 8 la hora), Carlos todavía sin él.
await consulta(
  `with nuevos as (
     insert into trabajadores (nombres, apellidos, dni, cargo, area_id, creado_por)
     select t.nombres, t.apellidos, t.dni, t.cargo, (select id from areas where codigo = 'MTZ'),
            (select id from usuarios where correo = $4)
       from (values ($1, 'Prueba Soldadura', '7' || $5 || '01', 'Soldadora'),
                    ($2, 'Prueba Armado',    '7' || $5 || '02', 'Armador'),
                    ($3, 'Prueba Sin Costo', '7' || $5 || '03', 'Ayudante')) as t(nombres, apellidos, dni, cargo)
     returning id, nombres)
   insert into trabajador_costos (trabajador_id, costo_mensual)
   select id, case when nombres = $1 then 2400 else 1920 end from nuevos where nombres <> $3`,
  [ana, bruno, carlos, CUENTAS.rrhh, sello],
)
let idReporte1 = null
let idReporte2 = null

// ------------------------------------------- 1. el supervisor sube su reporte
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  const pestana = await pagina.locator('a[href="/reportes-diarios"]').count()
  comprobar(pestana >= 1, `el supervisor tiene «Reporte» en su teléfono (${pestana} enlaces)`)

  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1', { hasText: 'Reporte diario' }).count()) === 1, 'abre «Reporte diario»')
  await pagina.getByRole('link', { name: 'Nuevo reporte' }).click()
  await pagina.waitForURL('**/reportes-diarios/nuevo')
  await pagina.waitForLoadState('networkidle')

  await pagina.fill('#rd-codigo', codigo.toLowerCase())
  await pagina.fill('#rd-asunto', asunto1)
  await pagina.fill('#rd-descripcion', 'Se avanzó la tolva del lado izquierdo; mañana se sigue con el derecho.')

  const t1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegirPersona(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
  await t1.locator('textarea').fill('Soldadura de la tolva, lado izquierdo')
  await t1.locator('input[type="number"]').first().fill('60')
  await elegirPersona(pagina, 'Personal del trabajo 1: persona 1', ana)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 1' }).fill('8')
  await t1.getByRole('button', { name: 'Agregar persona' }).click()
  await elegirPersona(pagina, 'Personal del trabajo 1: persona 2', carlos)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 1: horas de la persona 2' }).fill('4')

  await pagina.getByRole('button', { name: 'Agregar trabajo' }).click()
  const t2 = pagina.locator('fieldset[data-trabajo="2"]')
  await elegirPersona(pagina, 'Trabajo 2: sobre qué', 'Tarea nueva')
  await t2.locator('textarea').fill('Armado del bastidor')
  await t2.locator('input[type="number"]').first().fill('100')
  await elegirPersona(pagina, 'Personal del trabajo 2: persona 1', bruno)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 2: horas de la persona 1' }).fill('3.5')
  await t2.getByRole('button', { name: 'Agregar persona' }).click()
  await elegirPersona(pagina, 'Personal del trabajo 2: persona 2', ana)
  await pagina.getByRole('spinbutton', { name: 'Personal del trabajo 2: horas de la persona 2' }).fill('2')

  const resumen = limpio(await pagina.locator('[aria-live="polite"]:not([data-opciones])').textContent())
  comprobar(/3 personas · 17\.5 h en total/.test(resumen.replace(/,/g, '.')) || /3 personas/.test(resumen), `el resumen suma por persona (${resumen.slice(0, 120)})`)

  // Las fotos: un archivo que no es foto no entra; las dos de verdad se achican y suben.
  const galeria = pagina.locator('input[type="file"]:not([capture])')
  await galeria.setInputFiles(join(fotos, 'no-es-foto.jpg'))
  const falla = pagina.locator('ul[aria-label="Fotos que no entraron"] li')
  await falla.first().waitFor({ timeout: 15000 }).catch(() => {})
  comprobar((await falla.count()) === 1, `un archivo que no es foto no entra (${limpio(await falla.first().textContent().catch(() => ''))})`)
  const enviarBloqueado = await pagina.getByRole('button', { name: 'Subir reporte' }).isDisabled()
  comprobar(enviarBloqueado, 'con una foto que no entró, «Subir reporte» espera')
  await pagina.getByRole('button', { name: 'Quitar no-es-foto.jpg' }).click()

  await galeria.setInputFiles([join(fotos, 'tolva-grande.jpg'), join(fotos, 'chasis.png')])
  const boton = pagina.getByRole('button', { name: 'Subir reporte' })
  await boton.waitFor({ timeout: 60000 })
  await pagina.waitForFunction(() => !document.body.innerText.includes('subiendo…'), null, { timeout: 60000 })
  comprobar(!(await boton.isDisabled()), 'con las fotos arriba, «Subir reporte» se habilita')
  await pagina.screenshot({ path: join(CAPTURAS, 'reporte-diario-formulario.png'), fullPage: true })

  // Tres toques seguidos: un solo reporte.
  await boton.click()
  await boton.click({ timeout: 500 }).catch(() => {})
  await boton.click({ timeout: 500 }).catch(() => {})
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idReporte1 = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idReporte1), `al subir, abre el reporte (${pagina.url()})`)
  const aviso = limpio(await pagina.locator('[role="status"]').textContent().catch(() => ''))
  comprobar(aviso.includes('Reporte subido') && aviso.includes(codigo), `avisa que subió con su código (${aviso})`)

  const [r] = await consulta(
    `select count(*)::int as n, min(id::text) as id from reportes_diarios where asunto = $1`,
    [asunto1],
  )
  comprobar(r.n === 1 && r.id === idReporte1, `tres toques dieron un solo reporte (${r.n})`)
  const guardadas = await consulta(
    `select o.metadata->>'mimetype' as tipo, (o.metadata->>'size')::int as peso
       from reporte_diario_fotos f join storage.objects o on o.bucket_id = 'fotos-reporte-diario' and o.name = f.ruta
      where f.reporte_id = $1 order by f.orden`,
    [idReporte1],
  )
  comprobar(guardadas.length === 2, `quedan las dos fotos (${guardadas.length})`)
  comprobar(
    guardadas.every((f) => f.tipo === 'image/jpeg' && f.peso < pesoGrande && f.peso < 5 * 1024 * 1024),
    `se achicaron a JPEG antes de subir (${guardadas.map((f) => `${f.tipo} ${(f.peso / 1024).toFixed(0)} KB`).join(', ')})`,
  )
  const lineas = await consulta(
    `select p.nombre, p.horas::float as horas, t.id is not null as en_costeo
       from reporte_diario_personal p left join tareos t on t.reporte_linea_id = p.id
      where p.reporte_id = $1 order by p.nombre, p.horas`,
    [idReporte1],
  )
  const enCosteo = lineas.filter((l) => l.en_costeo).map((l) => `${l.nombre.split(' ')[0]} ${l.horas}`)
  const esperan = lineas.filter((l) => !l.en_costeo).map((l) => `${l.nombre.split(' ')[0]} ${l.horas}`)
  comprobar(lineas.length === 4 && esperan.length === 1 && esperan[0].startsWith('Carlos'), `en el costeo: ${enCosteo.join(', ')}; esperan su costo: ${esperan.join(', ')}`)

  const detalle = limpio(await pagina.locator('main').textContent())
  comprobar(detalle.includes('Soldadura de la tolva') && detalle.includes('Armado del bastidor'), 'el detalle muestra los dos trabajos')
  comprobar((await pagina.locator('[role="progressbar"]').count()) >= 2, 'cada trabajo con su barra de avance')
  comprobar((await pagina.locator('main img').count()) === 2, `el detalle muestra las dos fotos (${await pagina.locator('main img').count()})`)
  comprobar(!detalle.includes('En el costeo') && !detalle.includes('Espera su costo'), 'el supervisor no ve el estado del costeo')
  await pagina.screenshot({ path: join(CAPTURAS, 'reporte-diario-detalle-supervisor.png'), fullPage: true })
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------- 2. personal general y el tope de 16 horas
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios/nuevo`, { waitUntil: 'networkidle' })
  await pagina.fill('#rd-codigo', 'PLANTA')
  await pagina.fill('#rd-asunto', asunto2)
  await pagina.fill('#rd-descripcion', 'Orden y mantenimiento de la planta.')
  const t1 = pagina.locator('fieldset[data-trabajo="1"]')
  await elegirPersona(pagina, 'Trabajo 1: sobre qué', 'Tarea nueva')
  await t1.locator('textarea').fill('Limpieza del área de soldadura')
  await t1.locator('input[type="number"]').first().fill('100')
  await pagina.getByText('Personal general para todo el reporte').click()
  comprobar((await pagina.getByRole('group', { name: 'Personal del trabajo 1' }).count()) === 0, 'con «Personal general», los trabajos ya no piden gente')
  await elegirPersona(pagina, 'Personal general del reporte: persona 1', ana)
  // Ana ya tiene 10 h hoy: con 7 más pasaría de 16.
  await pagina.getByRole('spinbutton', { name: 'Personal general del reporte: horas de la persona 1' }).fill('7')
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  const alerta = pagina.locator('form [role="alert"]').last()
  await alerta.waitFor({ timeout: 15000 }).catch(() => {})
  const textoAlerta = limpio(await alerta.textContent().catch(() => ''))
  comprobar(/16 horas/.test(textoAlerta), `la base rechaza pasar de 16 horas en el día (${textoAlerta})`)
  comprobar((await pagina.inputValue('#rd-asunto')) === asunto2, 'tras el rechazo, lo escrito sigue en el formulario')

  await pagina.getByRole('spinbutton', { name: 'Personal general del reporte: horas de la persona 1' }).fill('6')
  await pagina.getByRole('button', { name: 'Subir reporte' }).click()
  await pagina.waitForURL(/\/reportes-diarios\/[0-9a-f-]{36}\?subido=1/, { timeout: 30000 }).catch(() => {})
  await pagina.waitForLoadState('networkidle')
  idReporte2 = pagina.url().match(/reportes-diarios\/([0-9a-f-]{36})/)?.[1] ?? null
  comprobar(Boolean(idReporte2), 'con 6 horas (16 en el día) sí entra')
  const tarjeta = limpio(await pagina.locator('main').textContent())
  comprobar(tarjeta.includes('Personal general') && tarjeta.includes('sin fotos'), 'el detalle muestra el personal general y que no lleva fotos')

  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  const filas = await pagina.locator('[data-reporte]', { hasText: sello }).count()
  comprobar(filas === 2, `su lista trae sus dos reportes (${filas})`)
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ------------------------------- 3. otro supervisor no ve lo de Maestranza
{
  const { pagina, contexto } = await entrar(CUENTAS.acb, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-reporte]').count()) === 0, 'el supervisor de Acabados no ve los reportes de Maestranza')
  // Con `loading.tsx` la respuesta ya salió con 200 cuando llega el «no existe»: se mira el texto.
  await pagina.goto(`${BASE}/reportes-diarios/${idReporte1}`, { waitUntil: 'networkidle' })
  const texto = limpio(await pagina.locator('body').textContent())
  comprobar(texto.includes('No encontramos lo que buscas') && !texto.includes(asunto1), 'ni abriendo su URL')
  await contexto.close()
}

// ----------------------------------------------- 4. RR. HH. y el costeo
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
  comprobar((await pagina.locator('nav a[href="/reportes-diarios"]').count()) >= 1, 'el menú de RR. HH. trae «Reporte diario»')
  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-reporte]').count()) >= 2, 'RR. HH. ve los reportes de los supervisores')
  await pagina.goto(`${BASE}/reportes-diarios/${idReporte1}`, { waitUntil: 'networkidle' })
  // La insignia está dos veces por fila (una para el teléfono): se cuentan las visibles.
  const visibles = (texto) => pagina.getByText(texto, { exact: true }).filter({ visible: true }).count()
  const enCosteo = await visibles('En el costeo')
  const esperan = await visibles('Espera su costo mensual')
  comprobar(enCosteo === 3 && esperan === 1, `RR. HH. ve 3 líneas en el costeo y 1 esperando su costo (${enCosteo} y ${esperan})`)
  comprobar((await pagina.getByRole('button', { name: 'Anular' }).count()) === 1, 'RR. HH. puede anular')

  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  let costeo = limpio(await pagina.locator('main').textContent())
  comprobar(costeo.includes('Horas de los reportes que esperan su costo') && costeo.includes(carlos), 'el costeo avisa que las horas de Carlos esperan su costo')
  comprobar(costeo.includes(codigo) && costeo.includes('PLANTA'), `el costeo trae los dos códigos (${codigo} y PLANTA)`)
  comprobar((await pagina.locator(`a[href="/reportes-diarios/${idReporte1}"]`).count()) >= 1, 'cada carga enlaza al reporte de donde salió')
  await pagina.screenshot({ path: join(CAPTURAS, 'reporte-diario-costeo-rrhh.png'), fullPage: true })

  // RR. HH. le pone su costo a Carlos y sus horas entran solas.
  await pagina.goto(`${BASE}/rrhh/personal`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: `Corregir la ficha de ${carlos} Prueba Sin Costo` }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('input[name="banco"]').fill('Banco de Pruebas')
  await v.locator('input[name="numero_cuenta"]').fill('191-00000-0-03')
  await v.locator('input[name="costo_mensual"]').fill('1680')
  // La ficha pide la fecha de ingreso desde 20261020120000; Carlos se registró sin ella.
  if (!(await v.locator('input[name="fecha_ingreso"]').inputValue())) await v.locator('input[name="fecha_ingreso"]').fill('2026-01-05')
  await v.getByRole('button', { name: 'Guardar la ficha' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  const [carlosLinea] = await consulta(
    `select t.costo_hora::float as hora, t.horas::float as horas from reporte_diario_personal p join tareos t on t.reporte_linea_id = p.id
      where p.reporte_id = $1 and p.nombre like $2`,
    [idReporte1, `${carlos}%`],
  )
  comprobar(carlosLinea?.hora === 7 && carlosLinea?.horas === 4, `al ponerle su costo, sus 4 h entran a S/ 7.00 la hora (${JSON.stringify(carlosLinea)})`)
  await pagina.goto(`${BASE}/rrhh/costeo`, { waitUntil: 'networkidle' })
  costeo = limpio(await pagina.locator('main').textContent())
  comprobar(!costeo.includes('Horas de los reportes que esperan su costo'), 'el aviso de horas en espera desaparece')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// --------------------------------------------- 5. Gerencia solo consulta
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.gerencia)
  comprobar((await pagina.locator('nav a[href="/reportes-diarios"]').count()) >= 1, 'el menú de Gerencia trae «Reporte diario»')
  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('[data-reporte]').count()) >= 2, 'Gerencia ve los reportes')
  comprobar((await pagina.getByRole('link', { name: 'Nuevo reporte' }).count()) === 0, 'Gerencia no tiene «Nuevo reporte»')
  await pagina.goto(`${BASE}/reportes-diarios/${idReporte1}`, { waitUntil: 'networkidle' })
  const detalle = limpio(await pagina.locator('main').textContent())
  comprobar((await pagina.getByRole('button', { name: 'Anular' }).count()) === 0 && !detalle.includes('En el costeo'), 'Gerencia ve el reporte sin anular ni costeo')
  comprobar((await pagina.locator('main img').count()) === 2, 'Gerencia ve las fotos')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

// ---------------------------------------------------- 6. la portería no
{
  const { pagina, contexto } = await entrar(CUENTAS.porteria, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios`, { waitUntil: 'networkidle' })
  comprobar(pagina.url().includes('/sin-permiso'), `la portería no entra (${new URL(pagina.url()).pathname})`)
  await contexto.close()
}

// ------------------------------------- 7. el supervisor anula su reporte
{
  const { pagina, contexto, errores } = await entrar(CUENTAS.mtz, CELULAR)
  await pagina.goto(`${BASE}/reportes-diarios/${idReporte2}`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Anular' }).click()
  const v = pagina.locator('[role="dialog"]')
  await v.locator('textarea[name="motivo"]').fill('Puse mal las horas; lo subo de nuevo.')
  await v.getByRole('button', { name: 'Anular' }).click()
  await v.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {})
  // La ventana se cierra primero y la pantalla se repinta después.
  await pagina.getByText(/^Anulado el/).waitFor({ timeout: 15000 }).catch(() => {})
  const texto = limpio(await pagina.locator('main').textContent())
  comprobar(texto.includes('Anulado el') && texto.includes('Puse mal las horas'), 'el reporte queda anulado con su motivo')
  const [t] = await consulta(
    `select count(*)::int as n, count(t.anulado_en)::int as anulados from reporte_diario_personal p join tareos t on t.reporte_linea_id = p.id where p.reporte_id = $1`,
    [idReporte2],
  )
  comprobar(t.n > 0 && t.n === t.anulados, `sus horas salen del costeo (${t.anulados} de ${t.n} anuladas)`)
  comprobar((await pagina.getByRole('button', { name: 'Anular' }).count()) === 0, 'un reporte anulado ya no ofrece «Anular»')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
  await contexto.close()
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobaciones fallaron.` : '\nTodo pasa.')
process.exit(fallas.length ? 1 : 0)
