/**
 * Recursos Humanos vuelve a cargar el Excel corregido de la planilla, con clic
 * real y su propia cuenta (nunca ADMIN):
 *
 *   1. Importa el libro del mes con tres personas, en las filas 1, 16 y 31 de
 *      la hoja RESUMEN.
 *   2. Corrige el libro: suma a una cuarta persona arriba, y las otras se
 *      corren quince filas. Lo vuelve a cargar en la MISMA planilla: las de
 *      antes salen como «ya está», elige a la nueva —que cae en la fila 1, la
 *      que tenía otra en la primera carga— y entra. Antes de la migración
 *      20261021150000 caía con «Ya existe un registro con esos datos.».
 *   3. Corrige en el libro el nombre de una que ya entró, quita a otra y suma a
 *      alguien que solo comparte «DE LA» con la quitada. La ventana avisa que
 *      las de antes ya están y no figuran en el Excel; la del nombre corregido
 *      lo dice en su fila y «Elegir las N» no la mete; la nueva no se marca.
 *   4. En la planilla administrativa del mismo mes, «Agregar persona … a mano»
 *      con el nombre de una que ya está en la de taller no entra.
 *   5. En la planilla quedan las cuatro, cada una con la hoja y fila de su carga.
 *
 * Variables: BANCO_CLAVE (la clave local de las cuentas), BASE
 * (http://localhost:3111). La planilla es de un mes lejano (2090 en adelante)
 * para no cruzarse con los datos de demostración; las personas son inventadas.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import ExcelJS from 'exceljs'
import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const RRHH = process.env.RRHH ?? 'rrhh.local@metalwork.test'
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

/** Una función de la base con el rol real del puesto, como la llama la aplicación. */
async function comoPuesto(correo, sql, valores = []) {
  await base.query('begin')
  try {
    const [{ id }] = await consulta('select id from usuarios where correo = $1', [correo])
    await base.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
      JSON.stringify({ sub: id, role: 'authenticated' }),
      id,
    ])
    await base.query('set local role authenticated')
    const filas = (await base.query(sql, valores)).rows
    await base.query('commit')
    return filas
  } catch (e) {
    await base.query('rollback')
    throw e
  }
}

// ------------------------------------------------- la planilla y los libros
const MESES = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SETIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE']
const [{ periodo }] = await consulta(`
  select to_char(m, 'YYYY-MM-DD') as periodo
    from generate_series('2090-01-01'::date, '2189-12-01'::date, interval '1 month') m
   where not exists (select 1 from planillas p where p.periodo = m and p.tipo = 'TALLER')
   order by m limit 1`)
const [anio, mes] = periodo.split('-')
const hoja = `RESUMEN ${MESES[Number(mes) - 1]} MWP - ${anio}`
const [{ id: planillaId }] = await comoPuesto(RRHH,
  `insert into planillas (tipo, periodo, moneda, observacion) values ('TALLER', $1, 'PEN', 'Prueba del banco: Excel corregido') returning id`, [periodo])

const sello = Date.now().toString().slice(-6)
const ANA = `QUISPE ROJAS ANA ${sello}`
const JORGE = `RAMOS TELLO JORGE ${sello}`
const NUEVA = `TORRES LAZO JULIA ${sello}`
const ANA_CORREGIDA = `QUISPE ROJAS ANA LUCIA ${sello}`
// Comparten «DE LA» y nada más: no son la misma persona.
const MARIA = `PEREZ DE LA TORRE MARIA ${sello}`
const PEDRO = `GARCIA DE LA CRUZ PEDRO ${sello}`

/** Una boleta de quince filas, con la forma de la del Excel de RR. HH. */
function boleta(nombre, sueldo) {
  const descuentos = Math.round(sueldo * 0.13 * 100) / 100
  return [
    [null, 'NOMBRES Y APELLIDOS', nombre],
    [null, 'PUESTO DE TRABAJO :', 'SOLDADOR'],
    [null, 'N° DE DÍAS TRABAJADOS', 'N° DE HORAS TRABAJADAS', null, 'N° DE HORAS EXTRAS '],
    [null, 30, 240, null, 0],
    [null, 'INGRESOS', null, 'DESCUENTOS'],
    [null, 'SUELDO SIN BONOS', sueldo, 'APORTE  10.00%', descuentos],
    [], [], [], [],
    [null, 'TOTAL', sueldo, 'TOTAL', descuentos],
    [],
    [null, 'ESSALUD ', 0.09, null, Math.round(sueldo * 9) / 100],
    [null, 'NETO A RECIBIR', null, Math.round((sueldo - descuentos) * 100) / 100],
    [],
  ]
}

async function libro(archivo, personas) {
  const l = new ExcelJS.Workbook()
  const h = l.addWorksheet(hoja)
  for (const [nombre, sueldo] of personas) for (const fila of boleta(nombre, sueldo)) h.addRow(fila.length ? fila : [null])
  const ruta = join(CAPTURAS, archivo)
  await l.xlsx.writeFile(ruta)
  return ruta
}
const primero = await libro(`planilla-${sello}-primera.xlsx`, [[ANA, 2000], [JORGE, 2400], [MARIA, 1500]])
const corregido = await libro(`planilla-${sello}-corregida.xlsx`, [[NUEVA, 1800], [ANA, 2000], [JORGE, 2400], [MARIA, 1500]])
const renombrado = await libro(`planilla-${sello}-nombre-corregido.xlsx`, [[NUEVA, 1800], [ANA_CORREGIDA, 2000], [JORGE, 2400], [PEDRO, 1500]])

// ------------------------------------------------- RR. HH. con clic real
const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })
const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
const pagina = await contexto.newPage()
// Las capturas van con `caret: 'initial'`: la de Playwright esconde el cursor con
// un estilo, y si cae mientras React hidrata, la consola dice que el HTML no cuadra.
const errores = []
pagina.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('_next/hmr') && !m.text().includes('WebSocket')) errores.push(m.text().slice(0, process.env.LARGO ? 6000 : 300))
})

try {
  await pagina.goto(`${BASE}/ingresar`, { waitUntil: 'networkidle' })
  await pagina.fill('input[type="email"]', RRHH)
  await pagina.fill('input[type="password"]', CLAVE)
  await Promise.all([
    pagina.waitForURL((u) => !u.pathname.startsWith('/ingresar'), { timeout: 30000 }).catch(() => {}),
    pagina.click('button[type="submit"]'),
  ])
  if (pagina.url().includes('/ingresar')) throw new Error(`No se pudo entrar como ${RRHH}`)

  const titulo = `${mes}/${anio}`
  async function cargar(ruta, elegir) {
    await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
    const tarjeta = pagina.locator('section, article, div').filter({ has: pagina.getByText(titulo, { exact: false }) })
      .filter({ has: pagina.getByRole('button', { name: 'Importar del Excel' }) }).last()
    await tarjeta.getByRole('button', { name: 'Importar del Excel' }).click()
    const v = pagina.locator('[role="dialog"]')
    await v.locator('input[type="file"]').setInputFiles(ruta)
    await v.getByRole('button', { name: 'Leer y comprobar' }).click()
    await v.getByText('Hojas leídas').waitFor({ timeout: 30000 })
    for (const nombre of elegir) await v.locator('label', { hasText: nombre }).locator('input[type="checkbox"]').check()
    return v
  }
  async function importar(v) {
    await v.getByRole('button', { name: /^Importar \d/ }).click()
    await Promise.race([
      v.waitFor({ state: 'hidden', timeout: 30000 }),
      v.locator('[role="alert"]').waitFor({ timeout: 30000 }),
    ]).catch(() => {})
    return limpio(await v.locator('[role="alert"]').textContent({ timeout: 500 }).catch(() => ''))
  }

  // 1. La primera carga.
  let v = await cargar(primero, [ANA, JORGE, MARIA])
  let error = await importar(v)
  comprobar(!error, `la primera carga entra${error ? `: ${error}` : ''}`)

  // 2. El Excel corregido, en la misma planilla.
  v = await cargar(corregido, [])
  const deAntes = await v.locator('label', { hasText: ANA }).locator('input[type="checkbox"]').isDisabled()
  const fila1 = limpio(await v.locator('label', { hasText: NUEVA }).textContent())
  comprobar(deAntes, 'las personas de la primera carga salen como «ya está» y no se pueden elegir')
  comprobar(fila1.includes(`${hoja}, fila 1`), `la persona nueva cae en la fila 1, la que ya tenía otra (${fila1.slice(0, 90)})`)
  await v.locator('label', { hasText: NUEVA }).locator('input[type="checkbox"]').check()
  comprobar(!(await v.getByText(/no figuran? en este Excel/).count()), 'con las filas corridas no avisa de nadie: todas siguen en el libro')
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-excel-corregido-antes-de-importar.png`, fullPage: false, caret: 'initial' })
  error = await importar(v)
  comprobar(!error, `el Excel corregido se vuelve a cargar${error ? `: ${error}` : ''}`)
  const aviso = limpio(await pagina.getByRole('status').filter({ hasText: 'importada' }).first().textContent({ timeout: 10000 }).catch(() => ''))
  comprobar(aviso.startsWith('1 persona importada'), `dice cuántas entraron (${aviso.slice(0, 60)})`)
  await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
  const resumen = limpio(await pagina.getByText(`Planilla de taller · ${titulo}`).locator('xpath=..').textContent())
  comprobar(resumen.includes('4 personas'), `la planilla dice que tiene cuatro personas (${resumen.slice(0, 80)})`)
  comprobar(await pagina.getByText(NUEVA).first().isVisible(), 'la persona nueva se ve en la planilla')
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-excel-corregido-importado.png`, fullPage: false, caret: 'initial' })

  // 3. El nombre corregido en el libro: avisa antes de elegir.
  v = await cargar(renombrado, [])
  const avisoNombre = limpio(await v.getByText(/no figuran? en este Excel/).textContent({ timeout: 10000 }).catch(() => ''))
  comprobar(avisoNombre.includes(ANA) && avisoNombre.includes('nombre'), `avisa que ${ANA} ya está y no figura en el Excel (${avisoNombre.slice(0, 140)})`)
  const filaCorregida = limpio(await v.locator('label', { hasText: ANA_CORREGIDA }).textContent())
  comprobar(filaCorregida.includes(`¿Es ${ANA} con el nombre corregido?`), 'la fila con el nombre corregido lo dice en la propia fila')
  const filaPedro = limpio(await v.locator('label', { hasText: PEDRO }).textContent())
  comprobar(!filaPedro.includes('¿Es'), 'quien solo comparte «DE LA» con otra no sale como nombre corregido')
  comprobar((await v.getByRole('button', { name: 'Elegir las 1' }).count()) === 1, '«Elegir las N» cuenta a la persona nueva y no a la del nombre corregido')
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-excel-nombre-corregido-aviso.png`, fullPage: false, caret: 'initial' })
  await v.getByRole('button', { name: 'Cancelar' }).click()

  // 4. A mano, en la planilla administrativa del mismo mes, la misma persona
  //    tampoco entra (migración 20261021160000).
  await comoPuesto(RRHH, `insert into planillas (tipo, periodo, moneda, observacion) values ('ADMINISTRATIVA', $1, 'PEN', 'Prueba del banco: a mano')`, [periodo])
  await pagina.goto(`${BASE}/rrhh`, { waitUntil: 'networkidle' })
  const admin = pagina.locator('section, article, div')
    .filter({ has: pagina.getByText(`Planilla administrativa · ${titulo}`) })
    .filter({ has: pagina.getByText('Agregar persona o subcontrato a mano') }).last()
  await admin.getByText('Agregar persona o subcontrato a mano').click()
  await admin.locator('input[name="nombre"]').fill(`Quispe Rojas, Ana ${sello}`)
  await admin.locator('input[name="monto"]').fill('100')
  await admin.getByRole('button', { name: 'Agregar' }).click()
  const rechazo = limpio(await admin.locator('[role="alert"]').textContent({ timeout: 15000 }).catch(() => ''))
  comprobar(rechazo.includes('ya está en la planilla de taller de este mes'), `a mano tampoco entra dos veces en el mes (${rechazo.slice(0, 110)})`)
  await pagina.screenshot({ path: `${CAPTURAS}/rrhh-a-mano-ya-esta-en-el-mes.png`, fullPage: false, caret: 'initial' })

  // 5. Lo que quedó en la base.
  const personas = await consulta(`select nombre, fila_origen from planilla_personas where planilla_id = $1 order by fila_origen, nombre`, [planillaId])
  comprobar(personas.length === 4, `en la planilla quedan las cuatro personas (${personas.length})`)
  comprobar(personas.filter((p) => p.fila_origen === 1).length === 2, 'dos de dos cargas distintas comparten la fila 1, cada una de su libro')
  comprobar(errores.length === 0, `sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
} finally {
  await navegador.close()
  await base.end()
}

if (fallas.length) {
  console.error(`\n${fallas.length} falla(s).`)
  process.exit(1)
}
console.log('\nEl Excel corregido de la planilla se vuelve a cargar.')
