/**
 * Clic real sobre lo que DKS decidió el 2026-10-20 (migraciones 20261020160000
 * a 20261020163000), con la cuenta del puesto que hace cada cosa:
 *
 *   1. Recursos Humanos le pone a una cuenta su DNI en «DNI de las cuentas»
 *      (desde la migración 20261020165000 es suyo; el administrador solo lo
 *      ve). La base lo guarda en la tabla reservada y `usuarios` queda vacío.
 *      El administrador lo ve en Personal y en esa pantalla, sin campos ni
 *      lápiz para cambiarlo. El costo por hora de la cuenta ya no se pide
 *      (DKS, 2026-10-26): guardar el DNI no lo toca.
 *   2. Administración y Gerencia ven «Trabajos sin orden» en su menú;
 *      Administración aprueba el reporte de uno y la base lo dice.
 *   3. Ventas no ve «Quitar» en su cotización rechazada, y sí en la que acaba
 *      de subir.
 *   4. Almacén imprime el formato de una salida de materia prima con su número
 *      de la serie.
 *   5. Logística descarga la OC y dice quién la emitió y quién la aprobó.
 *
 * Los datos de partida los pone el script en la base del banco, distintos en
 * cada corrida. Variables: BANCO_CLAVE, BASE (http://localhost:3111), CAPTURAS,
 * BANCO_ADMIN (el correo del administrador del banco).
 */
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
const CUENTAS = {
  admin: process.env.BANCO_ADMIN ?? 'studiogrci@gmail.com',
  administracion: 'administracion.local@metalwork.test',
  gerencia: 'gerencia.local@metalwork.test',
  ventas: 'ventas.local@metalwork.test',
  almacen: 'almacen.local@metalwork.test',
  logistica: 'logistica.local@metalwork.test',
  rrhh: 'rrhh.local@metalwork.test',
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

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo) {
  const contexto = await navegador.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: 'America/Lima' })
  const pagina = await contexto.newPage()
  const errores = []
  pagina.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text().slice(0, 300))
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

const idDe = async (correo) => (await consulta('select id from public.usuarios where correo = $1', [correo]))[0]?.id
const sufijo = randomUUID().slice(0, 6).toUpperCase()

try {
  // ---------------------------------------------- 1. el DNI de la cuenta
  {
    const [persona] = await consulta(
      `select u.id, u.nombres from public.usuarios u join public.roles r on r.id = u.rol_id
        where u.activo and u.es_operario order by u.apellidos limit 1`,
    )
    comprobar(Boolean(persona), 'hay un operario en el banco para la prueba')
    const [cuenta] = await consulta('select correo, apellidos from public.usuarios where id = $1', [persona.id])
    const dni = `4${String(Date.now()).slice(-7)}`
    {
      const { pagina, contexto, errores } = await entrar(CUENTAS.rrhh)
      await pagina.goto(`${BASE}/rrhh/cuentas`, { waitUntil: 'networkidle' })
      const fila = pagina.locator(`tr[data-cuenta="${cuenta.correo}"]`)
      const [antes] = await consulta('select costo_hora::float as costo from public.usuario_datos_reservados where usuario_id = $1', [persona.id])
      await fila.getByRole('button', { name: /Cambiar el DNI de/ }).click()
      const v = pagina.locator('[role="dialog"]')
      comprobar((await v.locator('input[name="costo_hora"]').count()) === 0, 'la ventana ya no pide el costo por hora')
      await v.locator('input[name="documento"]').fill(dni)
      await v.getByRole('button', { name: 'Guardar' }).click()
      await v.waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
      const [u] = await consulta('select documento, costo_hora::float as costo from public.usuarios where id = $1', [persona.id])
      const [r] = await consulta('select documento, costo_hora::float as costo from public.usuario_datos_reservados where usuario_id = $1', [persona.id])
      comprobar(u.documento === null && u.costo === 0, 'en usuarios, que lee toda cuenta, no quedó ni el DNI ni el costo')
      comprobar(r?.documento === dni && r?.costo === (antes?.costo ?? 0), `RR. HH. guarda el DNI en la tabla reservada y el costo queda como estaba (${JSON.stringify(r)})`)
      await pagina.reload({ waitUntil: 'networkidle' })
      const texto = (await fila.innerText()).replace(/\s+/g, ' ')
      comprobar(texto.includes(dni), `la fila vuelve a mostrar el DNI («${texto.slice(0, 120)}»)`)
      await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-cuentas-rrhh.png'), fullPage: true })
      comprobar(errores.length === 0, `DNI de las cuentas sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
      await contexto.close()
    }
    {
      const { pagina, contexto, errores } = await entrar(CUENTAS.admin)
      await pagina.goto(`${BASE}/personal`, { waitUntil: 'networkidle' })
      await pagina.getByRole('button', { name: `Editar a ${persona.nombres}` }).first().click()
      const v = pagina.locator('[role="dialog"]')
      comprobar((await v.locator('#documento, #costo_hora, input[name="costo_hora"]').count()) === 0, 'en Personal el administrador ya no tiene los campos del DNI y el costo')
      const ficha = (await v.innerText()).replace(/\s+/g, ' ')
      comprobar(ficha.includes(dni) && !ficha.includes('costo por hora') && ficha.includes('Recursos Humanos'), 'pero ve el DNI, sin el costo por hora, y dice que lo cambia Recursos Humanos')
      await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-personal.png'), fullPage: true })
      await pagina.keyboard.press('Escape')
      await pagina.goto(`${BASE}/rrhh/cuentas`, { waitUntil: 'networkidle' })
      comprobar(new URL(pagina.url()).pathname === '/rrhh/cuentas', 'el administrador abre «DNI de las cuentas»')
      comprobar((await pagina.getByRole('button', { name: /Cambiar el DNI de/ }).count()) === 0, 'solo para mirar: sin lápiz')
      await pagina.goto(`${BASE}/personal?q=${dni}`, { waitUntil: 'networkidle' })
      comprobar(await pagina.getByRole('button', { name: `Editar a ${persona.nombres}` }).first().isVisible().catch(() => false),
        'el buscador de Personal la encuentra por su DNI')
      comprobar(errores.length === 0, `Personal sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
      await contexto.close()
    }
    {
      const { pagina, contexto } = await entrar(CUENTAS.administracion)
      await pagina.goto(`${BASE}/rrhh/cuentas`, { waitUntil: 'networkidle' })
      comprobar(new URL(pagina.url()).pathname === '/sin-permiso', 'Administración no abre el DNI y el costo de las cuentas')
      await contexto.close()
    }
  }

  // ------------------------------------------ 2. trabajos sin OT: aprobar
  {
    const admin = await idDe(CUENTAS.admin)
    const placa = `Q${sufijo.slice(0, 2)}-${sufijo.slice(2, 5)}`
    const [unidad] = await consulta(
      `insert into public.flota_unidades (placa, trabajo, registrado_por) values ($1, 'Cambio de piso (banco)', $2) returning id`,
      [placa, admin],
    )
    const [avance] = await consulta(
      `insert into public.flota_avances (flota_id, area_id, descripcion, registrado_por)
       values ($1, (select id from public.areas where codigo = 'ACB'), $2, $3) returning id`,
      [unidad.id, `Piso nuevo ${sufijo}`, admin],
    )
    const [otro] = await consulta(
      `insert into public.flota_avances (flota_id, area_id, descripcion, registrado_por)
       values ($1, (select id from public.areas where codigo = 'ACB'), $2, $3) returning id`,
      [unidad.id, `Pintura del piso ${sufijo}`, admin],
    )
    for (const puesto of ['administracion', 'gerencia']) {
      const { pagina, contexto } = await entrar(CUENTAS[puesto])
      comprobar(await pagina.getByRole('link', { name: /Trabajos sin orden/ }).first().isVisible().catch(() => false),
        `${puesto} tiene «Trabajos sin orden» en su menú`)
      if (puesto === 'administracion') {
        await pagina.goto(`${BASE}/avance/trabajos/${unidad.id}`, { waitUntil: 'networkidle' })
        comprobar(await pagina.getByText(`Piso nuevo ${sufijo}`).isVisible().catch(() => false), 'Administración ve el reporte')
        await pagina.getByRole('listitem').filter({ hasText: `Piso nuevo ${sufijo}` })
          .getByRole('button', { name: 'Aprobar', exact: true }).click()
        await pagina.getByText('Aprobado.').waitFor({ timeout: 15000 }).catch(() => {})
        const [fila] = await consulta('select revision::text from public.flota_avances where id = $1', [avance.id])
        comprobar(fila.revision === 'APROBADO', `la base dice que Administración lo aprobó (${fila.revision})`)
        await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-trabajo-sin-ot.png'), fullPage: true })
      } else {
        // Gerencia: el aviso la lleva a los trabajos sin orden, la tarjeta dice
        // cuántos esperan, aprueba con clic y lo aprobado no lo puede borrar.
        // Cuántos, depende de lo que otras pruebas dejaron en la base: basta con
        // que la tarjeta cuente alguno (el de esta prueba está pendiente).
        comprobar(await pagina.locator('a[href="/avance/trabajos"]').filter({ hasText: /orden\s*[1-9]\d*$/ }).first().isVisible().catch(() => false),
          'el pendiente de Gerencia se cuenta en «Trabajos sin orden»')
        await pagina.goto(`${BASE}/avance/trabajos`, { waitUntil: 'networkidle' })
        comprobar(await pagina.getByText('1 por aprobar').first().isVisible().catch(() => false), 'la tarjeta del trabajo dice «1 por aprobar»')
        await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-trabajos-gerencia.png'), fullPage: true })
        await pagina.goto(`${BASE}/avance/trabajos/${unidad.id}`, { waitUntil: 'networkidle' })
        await pagina.getByRole('listitem').filter({ hasText: `Pintura del piso ${sufijo}` })
          .getByRole('button', { name: 'Aprobar', exact: true }).click()
        await pagina.getByText('Aprobado.').waitFor({ timeout: 15000 }).catch(() => {})
        const [fila] = await consulta(
          `select a.revision::text, u.correo from public.flota_avances a left join public.usuarios u on u.id = a.revisado_por where a.id = $1`,
          [otro.id],
        )
        comprobar(fila.revision === 'APROBADO' && fila.correo === CUENTAS.gerencia, `la base dice que Gerencia lo aprobó (${fila.revision}, ${fila.correo})`)
        await pagina.reload({ waitUntil: 'networkidle' })
        comprobar((await pagina.getByRole('button', { name: /Eliminar/ }).count()) === 0, 'Gerencia no ve «Eliminar» en los reportes aprobados')
        await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-trabajo-gerencia.png'), fullPage: true })
      }
      await contexto.close()
    }
  }

  // -------------------------------- 3. la cotización rechazada no se quita
  {
    const ventas = await idDe(CUENTAS.ventas)
    const [cliente] = await consulta('select id from public.clientes order by razon_social limit 1')
    const [tipo] = await consulta('select id from public.tipos_carroceria order by codigo limit 1')
    const ids = { r: randomUUID(), n: randomUUID() }
    await consulta('set session_replication_role = replica')
    for (const [clave, estado, numero] of [['r', 'RECHAZADA', `R-${sufijo}`], ['n', 'POR_REVISAR', `N-${sufijo}`]]) {
      await consulta(
        `insert into public.cotizaciones_pdf (id, numero, cliente_id, tipo_carroceria_id, nombre_archivo, ruta_storage, estado, version, registrado_por, observacion)
         values ($1::uuid, $2::text, $3, $4, $2::text || '.pdf', 'cot/' || $1::text || '/' || $2::text || '.pdf', $5::public.estado_cotizacion_pdf, 1, $6, 'El precio no cuadra')`,
        [ids[clave], numero, cliente.id, tipo.id, estado, ventas],
      )
    }
    await consulta('set session_replication_role = origin')
    const { pagina, contexto } = await entrar(CUENTAS.ventas)
    await pagina.goto(`${BASE}/cotizaciones/pdf?buscar=${sufijo}`, { waitUntil: 'networkidle' })
    const quitarRechazada = pagina.getByRole('listitem').filter({ hasText: `R-${sufijo}` }).getByRole('button', { name: /Quitar/ })
    const quitarNueva = pagina.getByRole('listitem').filter({ hasText: `N-${sufijo}` }).getByRole('button', { name: /Quitar/ })
    comprobar(await pagina.getByText(`R-${sufijo}`).first().isVisible().catch(() => false), 'Ventas ve su cotización rechazada')
    comprobar((await quitarRechazada.count()) === 0, 'la rechazada no ofrece «Quitar»')
    comprobar((await quitarNueva.count()) > 0, 'la recién subida sí ofrece «Quitar»')
    const subir = pagina.getByRole('listitem').filter({ hasText: `R-${sufijo}` }).getByRole('button', { name: 'Subir corrección' })
    comprobar((await subir.count()) > 0, 'la rechazada ofrece «Subir corrección», como dice su aviso')
    await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-cotizaciones.png'), fullPage: true })
    await contexto.close()
  }

  // ---------------------------------- 4. la salida de almacén con número
  {
    const almacen = await idDe(CUENTAS.almacen)
    const [mp] = await consulta(
      `select m.id from public.materiales m join public.categorias_material c on c.id = m.categoria_id
        where c.almacen = 'MATERIA_PRIMA' and m.activo order by m.codigo limit 1`,
    )
    await consulta(
      `insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, registrado_por)
       values (gen_random_uuid(), 'INGRESO', 'SALDO_INICIAL', $1, 5, $2, $3)`,
      [mp.id, `Saldo ${sufijo}`, almacen],
    )
    const [salida] = await consulta(
      `insert into public.movimientos_materiales (id, tipo, origen, material_id, cantidad, documento_referencia, recibido_por_nombre, codigo_unidad, registrado_por)
       values (gen_random_uuid(), 'SALIDA', 'SALIDA_GENERAL', $1, 1, $2, 'Julio Ramírez', 'BANCO_' || $3::text, $4) returning id, numero_salida`,
      [mp.id, `Vale ${sufijo}`, sufijo, almacen],
    )
    comprobar(/^SA-\d{4}-\d{4}$/.test(salida.numero_salida ?? ''), `la salida nació con su número (${salida.numero_salida})`)
    const { pagina, contexto, errores } = await entrar(CUENTAS.almacen)
    await pagina.goto(`${BASE}/almacen/movimientos/${salida.id}/formato`, { waitUntil: 'networkidle' })
    comprobar(await pagina.getByText(`N.º ${salida.numero_salida}`).isVisible().catch(() => false), 'el formato imprime ese número')
    await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-formato-salida.png'), fullPage: true })
    comprobar(errores.length === 0, `el formato sin errores de consola${errores.length ? `: ${errores[0]}` : ''}`)
    await pagina.goto(`${BASE}/almacen/kardex`, { waitUntil: 'networkidle' })
    comprobar(await pagina.getByText(salida.numero_salida, { exact: true }).first().isVisible().catch(() => false),
      '«Salidas por cerrar» muestra el mismo número, para casar cada hoja con su fila')
    await pagina.screenshot({ path: join(CAPTURAS, 'decisiones-por-cerrar.png'), fullPage: true })
    await contexto.close()
  }

  // -------------------------------------- 5. la OC con quién firmó
  {
    const logistica = await idDe(CUENTAS.logistica)
    const gerencia = await idDe(CUENTAS.gerencia)
    const id = randomUUID()
    await consulta('set session_replication_role = replica')
    await consulta(
      `insert into public.ordenes_compra_materiales (id, numero, proveedor, referencia, creado_por, aprobacion, aprobado_por, aprobado_en, origen, motivo)
       values ($1, $2, 'PROVEEDOR DEL BANCO S.A.C.', $3, $4, 'APROBADA', $5, now(), 'DIRECTA', 'Compra directa del banco')`,
      [id, `OC-B${sufijo.slice(0, 3)}-MW`, `Ref ${sufijo}`, logistica, gerencia],
    )
    await consulta('set session_replication_role = origin')
    const [nombres] = await consulta(
      `select upper(e.nombres || ' ' || e.apellidos) as emisor, upper(a.nombres || ' ' || a.apellidos) as aprobador
         from public.usuarios e, public.usuarios a where e.id = $1 and a.id = $2`,
      [logistica, gerencia],
    )
    const { pagina, contexto } = await entrar(CUENTAS.logistica)
    const respuesta = await pagina.request.get(`${BASE}/compras/${id}/pdf`)
    comprobar(respuesta.status() === 200, `Logística descarga la OC (${respuesta.status()})`)
    if (respuesta.status() === 200) {
      const archivo = join(CAPTURAS, 'decisiones-oc.pdf')
      writeFileSync(archivo, await respuesta.body())
      const texto = execFileSync('pdftotext', ['-layout', archivo, '-']).toString().replace(/\s+/g, ' ')
      comprobar(texto.includes(nombres.emisor), `la OC dice quién la emitió (${nombres.emisor})`)
      comprobar(texto.includes(nombres.aprobador), `y quién la aprobó (${nombres.aprobador})`)
      comprobar(texto.includes(`SOLICITADO POR: ${nombres.emisor}`) && texto.includes(`APROBADO POR: ${nombres.aprobador} · `),
        'cada nombre va en su firma, y la aprobación con su fecha')
    }
    await contexto.close()
  }
} finally {
  await navegador.close()
  await base.end()
}

console.log(fallas.length ? `\n${fallas.length} fallas` : '\nTodo pasó.')
process.exit(fallas.length ? 1 : 0)
