/**
 * Clic real sobre el padrón de equipos de la planta (Plan 16, entrega 16.1,
 * migración 20261125160000), con la cuenta de cada puesto y mirando la base
 * después de cada toque.
 *
 * Mantenimiento da de alta un equipo sin escribir el código (la base pone el
 * que sigue en su categoría), el mismo envío tocado tres veces entra una vez,
 * un código repetido se rechaza sin perder lo escrito, cambia el estado, da de
 * baja con motivo y reactiva diciendo por qué (la baja queda en su historia),
 * agrega una categoría, y «Editar» no pisa lo que Almacén anotó. Almacén solo cambia quién
 * tiene el equipo. Gerencia lee sin botones. Ventas no entra.
 *
 * Deja en el banco los equipos que crea, con una marca propia en la
 * descripción: un equipo no se borra.
 *
 * Variables: BANCO_CLAVE, BASE (http://localhost:3111), BANCO_BASE (mw_demo), CAPTURAS.
 */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

import pg from 'pg'
import { chromium } from 'playwright-core'

import { esperarReactAlNavegar } from './con-react.mjs'

const BASE = process.env.BASE ?? 'http://localhost:3111'
const CLAVE = process.env.BANCO_CLAVE
const NAVEGADOR = process.env.BANCO_CHROMIUM ?? '/opt/pw-browsers/chromium-1243/chrome-linux64/chrome'
const CAPTURAS = process.env.CAPTURAS ?? '/tmp/banco-capturas'
if (!CLAVE) {
  console.error('Falta BANCO_CLAVE.')
  process.exit(1)
}
mkdirSync(CAPTURAS, { recursive: true })

const fallas = []
function comprobar(cond, texto) {
  console.log(`${cond ? '  ok' : 'FALLA'} · ${texto}`)
  if (!cond) fallas.push(texto)
}

const base = new pg.Client({ host: '/tmp', port: 5433, user: 'postgres', database: process.env.BANCO_BASE ?? 'mw_demo' })
await base.connect()
const una = async (sql, valores = []) => (await base.query(sql, valores)).rows[0]
const cuenta = async (correo) => (await una('select id from public.usuarios where correo = $1', [correo])).id

const sello = `QA-EQ-${Date.now().toString().slice(-6)}`
const descripcion = `Amoladora de prueba ${sello}`
const CATEGORIA = 'Amoladora de 4 1/2"'
const mantenimiento = await cuenta('mantenimiento.local@metalwork.test')

const navegador = await chromium.launch({ executablePath: NAVEGADOR, args: ['--no-sandbox'] })

async function entrar(correo, telefono = false) {
  const contexto = await navegador.newContext({
    viewport: telefono ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: telefono,
    isMobile: telefono,
    timezoneId: 'America/Lima',
  })
  const pagina = esperarReactAlNavegar(await contexto.newPage())
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

const ventana = (pagina) => pagina.getByRole('dialog')
const cerrada = (pagina) => ventana(pagina).waitFor({ state: 'hidden', timeout: 20000 })

// ---------------------------------------------------------------------------
// Mantenimiento lleva el padrón
// ---------------------------------------------------------------------------
{
  const { pagina, contexto, errores } = await entrar('mantenimiento.local@metalwork.test')

  // Su menú y su dashboard.
  const menu = (await pagina.locator('nav').first().innerText()).replace(/\s+/g, ' ')
  comprobar(/Equipos/.test(menu), `el menú de Mantenimiento trae «Equipos»: ${menu.slice(0, 80)}`)
  const inicio = (await pagina.locator('main').innerText()).replace(/\s+/g, ' ')
  comprobar(/Equipos parados/.test(inicio) && /Con observación/.test(inicio), 'su dashboard cuenta los equipos parados y con observación')

  await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
  comprobar((await pagina.locator('h1').innerText()).trim() === 'Equipos', 'Mantenimiento abre el padrón')

  // Alta sin escribir el código: la base pone el que sigue, y el formulario lo anuncia.
  const { que_sigue } = await una(
    `select public.equipo_codigo_que_sigue(id) as que_sigue from public.equipo_categorias where nombre = $1`,
    [CATEGORIA],
  )
  await pagina.getByRole('button', { name: 'Nuevo equipo' }).click()
  const alta = ventana(pagina)
  await alta.getByLabel('Categoría').selectOption({ label: CATEGORIA })
  const ayuda = (await alta.innerText()).replace(/\s+/g, ' ')
  comprobar(ayuda.includes(que_sigue), `el alta anuncia el código que sigue (${que_sigue})`)
  await alta.getByLabel('Descripción').fill(descripcion)
  await alta.getByLabel('Marca').fill('  DeWalt ')
  await alta.getByLabel('Área').selectOption({ label: 'Producción' })
  await alta.getByLabel('Ubicación').fill('Nave 1')
  await alta.getByLabel('A cargo de', { exact: true }).fill('operario de prueba')

  // El mismo envío, tocado tres veces: un solo equipo.
  const registrar = alta.getByRole('button', { name: 'Registrar equipo' })
  await registrar.click()
  await registrar.click({ force: true, timeout: 2000 }).catch(() => {})
  await registrar.click({ force: true, timeout: 2000 }).catch(() => {})
  await cerrada(pagina)
  await pagina.waitForLoadState('networkidle')
  const creados = (await base.query('select * from public.equipos where descripcion = $1', [descripcion])).rows
  comprobar(creados.length === 1, `tres toques a «Registrar equipo» dejan un equipo (hay ${creados.length})`)
  const equipo = creados[0]
  comprobar(equipo?.codigo === que_sigue, `la base le puso el código que sigue: ${equipo?.codigo}`)
  comprobar(equipo?.creado_por === mantenimiento, 'quedó a nombre de la cuenta de Mantenimiento')
  comprobar(equipo?.marca === 'DEWALT', `la marca queda en mayúsculas y sin espacios de más (${equipo?.marca})`)
  comprobar(equipo?.a_cargo_de === 'OPERARIO DE PRUEBA', `quién lo tiene va en mayúsculas (${equipo?.a_cargo_de})`)
  comprobar(equipo?.estado === 'OPERATIVO' && equipo?.activo === true, 'nace operativo y en uso')
  // El alta se cierra al contestar y la lista se pone al día enseguida.
  const fila = pagina.locator('tr', { hasText: equipo.codigo })
  await fila.waitFor({ timeout: 20000 }).catch(() => {})
  comprobar((await fila.count()) === 1, `la lista ya muestra ${equipo.codigo}`)

  // Un código que ya existe se rechaza y lo escrito sigue ahí.
  await pagina.getByRole('button', { name: 'Nuevo equipo' }).click()
  const repetido = ventana(pagina)
  await repetido.getByLabel('Categoría').selectOption({ label: CATEGORIA })
  await repetido.getByLabel('Código').fill(equipo.codigo.toLowerCase())
  await repetido.getByLabel('Descripción').fill(`${descripcion} repetido`)
  await repetido.getByLabel('Área').selectOption({ label: 'Producción' })
  await repetido.getByRole('button', { name: 'Registrar equipo' }).click()
  const aviso = repetido.getByRole('alert')
  await aviso.first().waitFor({ timeout: 20000 })
  const rechazo = (await aviso.first().innerText()).replace(/\s+/g, ' ')
  comprobar(/Ya hay un equipo con ese código/.test(rechazo), `el código repetido se rechaza diciendo por qué: «${rechazo.slice(0, 120)}»`)
  comprobar((await aviso.count()) === 1, 'una sola vez, sin repetirlo al pie')
  const enElCodigo = await repetido.getByLabel('Código').evaluate((c) => c.getAttribute('aria-invalid') === 'true' && document.activeElement === c)
  comprobar(enElCodigo, 'el aviso va en el campo «Código», marcado, con el cursor ahí')
  comprobar((await repetido.getByLabel('Descripción').inputValue()) === `${descripcion} repetido`, 'y lo escrito sigue en el formulario')
  comprobar((await una('select count(*)::int as n from public.equipos where descripcion = $1', [`${descripcion} repetido`])).n === 0, 'no entró nada')
  await repetido.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada(pagina)

  // «Otros» no tiene código propio: sin escribirlo, el navegador no envía.
  await pagina.getByRole('button', { name: 'Nuevo equipo' }).click()
  const otros = ventana(pagina)
  await otros.getByLabel('Categoría').selectOption({ label: 'Otros' })
  comprobar(await otros.getByLabel('Código').evaluate((c) => c.required), 'en «Otros» el código es obligatorio')
  await otros.getByRole('button', { name: 'Cancelar' }).click()
  await cerrada(pagina)

  // Estado: parado, con su nota.
  await pagina.getByRole('button', { name: `Estado de ${equipo.codigo}` }).click()
  const estado = ventana(pagina)
  await estado.getByLabel('Estado').selectOption({ label: 'Parado' })
  await estado.getByLabel('Qué tiene').fill('No enciende')
  await estado.getByRole('button', { name: 'Guardar estado' }).click()
  await cerrada(pagina)
  const parado = await una('select estado, estado_nota from public.equipos where id = $1', [equipo.id])
  comprobar(parado.estado === 'PARADO' && parado.estado_nota === 'No enciende', `«Guardar estado» lo deja parado con su nota (${parado.estado}, ${parado.estado_nota})`)
  comprobar(/Parado/.test(await pagina.locator('tr', { hasText: equipo.codigo }).innerText()), 'y la fila lo dice')

  // Mientras esta pantalla sigue abierta, Almacén anota quién lo tiene. «Editar»
  // de Mantenimiento ya no trae ese campo: no puede devolver el de antes.
  {
    const otra = await entrar('almacen.local@metalwork.test')
    await otra.pagina.goto(`${BASE}/equipos?q=${encodeURIComponent(equipo.codigo)}`, { waitUntil: 'networkidle' })
    await otra.pagina.getByRole('button', { name: `A cargo de ${equipo.codigo}` }).click()
    await ventana(otra.pagina).getByLabel('A cargo de', { exact: true }).fill('entregado por almacén')
    await ventana(otra.pagina).getByRole('button', { name: 'Guardar' }).click()
    await cerrada(otra.pagina)
    await otra.contexto.close()
  }

  // Corregir desde «Editar», con la lista pintada antes de lo de Almacén.
  await pagina.getByRole('button', { name: `Editar ${equipo.codigo}` }).click()
  const editar = ventana(pagina)
  comprobar((await editar.getByLabel('A cargo de', { exact: true }).count()) === 0, '«Editar» no trae «A cargo de»: tiene su botón')
  await editar.getByLabel('Ubicación').fill('Nave 2, puesto 4')
  await editar.getByRole('button', { name: 'Guardar cambios' }).click()
  await cerrada(pagina)
  const corregido = await una('select ubicacion, estado, codigo, a_cargo_de from public.equipos where id = $1', [equipo.id])
  comprobar(corregido.ubicacion === 'Nave 2, puesto 4' && corregido.estado === 'PARADO' && corregido.codigo === equipo.codigo, '«Guardar cambios» corrige la ubicación y no toca el estado ni el código')
  comprobar(corregido.a_cargo_de === 'ENTREGADO POR ALMACÉN', `ni lo que Almacén anotó entretanto (${corregido.a_cargo_de})`)
  const dicho = (await pagina.getByRole('status').filter({ hasText: /actualizado/ }).first().innerText().catch(() => '')).trim()
  comprobar(/Equipo .* actualizado/.test(dicho), `y lo dice arriba: «${dicho}»`)

  // Mantenimiento también anota quién lo tiene, con el mismo botón que Almacén.
  await pagina.getByRole('button', { name: `A cargo de ${equipo.codigo}` }).click()
  await ventana(pagina).getByLabel('A cargo de', { exact: true }).fill('operario de prueba')
  await ventana(pagina).getByRole('button', { name: 'Guardar' }).click()
  await cerrada(pagina)
  comprobar((await una('select a_cargo_de from public.equipos where id = $1', [equipo.id])).a_cargo_de === 'OPERARIO DE PRUEBA', 'Mantenimiento cambia «A cargo de» con su botón')

  // Dar de baja: sin motivo no sale, con motivo queda sellada.
  await pagina.getByRole('button', { name: `Editar ${equipo.codigo}` }).click()
  await ventana(pagina).getByRole('button', { name: 'Dar de baja' }).click()
  const baja = ventana(pagina)
  await baja.getByLabel('Motivo de la baja').waitFor()
  comprobar(await baja.getByLabel('Motivo de la baja').evaluate((c) => c.required), 'la baja pide su motivo')
  await baja.getByLabel('Motivo de la baja').fill('Se quemó el motor y no tiene arreglo')
  await baja.getByRole('button', { name: 'Dar de baja' }).click()
  await cerrada(pagina)
  const deBaja = await una('select activo, baja_motivo, baja_por, dado_de_baja_en from public.equipos where id = $1', [equipo.id])
  comprobar(deBaja.activo === false && deBaja.baja_por === mantenimiento && deBaja.dado_de_baja_en !== null, '«Dar de baja» lo saca de uso con quién y cuándo')
  comprobar(deBaja.baja_motivo === 'Se quemó el motor y no tiene arreglo', 'y guarda el motivo')
  await pagina.waitForLoadState('networkidle')
  comprobar((await pagina.locator('tr', { hasText: equipo.codigo }).count()) === 0, 'ya no figura entre los que están en uso')
  const dichoBaja = (await pagina.getByRole('status').filter({ hasText: /dado de baja/ }).first().innerText().catch(() => '')).trim()
  comprobar(dichoBaja.includes(equipo.codigo), `y la pantalla dice que se dio de baja: «${dichoBaja}»`)

  // Sigue en el padrón, entre los dados de baja, y se reactiva.
  await pagina.goto(`${BASE}/equipos?ver=de-baja`, { waitUntil: 'networkidle' })
  const filaDeBaja = pagina.locator('tr', { hasText: equipo.codigo })
  const textoDeBaja = (await filaDeBaja.innerText()).replace(/\s+/g, ' ')
  comprobar(/Dado de baja/.test(textoDeBaja) && /por Mantenimiento/.test(textoDeBaja), `figura entre los dados de baja, con su motivo y quién: «${textoDeBaja.slice(0, 160)}»`)
  await pagina.getByRole('button', { name: `Reactivar ${equipo.codigo}` }).click()
  const reactivar = ventana(pagina)
  const motivoReactivar = reactivar.getByLabel('Por qué vuelve a usarse')
  comprobar(await motivoReactivar.evaluate((c) => c.required), 'reactivar pide por qué')
  await motivoReactivar.fill('Se reparó el motor en el taller')
  await reactivar.getByRole('button', { name: 'Reactivar' }).click()
  await cerrada(pagina)
  await filaDeBaja.waitFor({ state: 'detached', timeout: 20000 }).catch(() => {})
  const vuelto = await una('select activo, baja_motivo, baja_por, estado from public.equipos where id = $1', [equipo.id])
  comprobar(vuelto.activo === true && vuelto.baja_motivo === null && vuelto.baja_por === null, '«Reactivar» lo devuelve al padrón')
  comprobar(vuelto.estado === 'PARADO', 'y vuelve como estaba: parado')
  const historia = await una('select motivo, baja_por, reactivado_por, reactivacion_motivo from public.equipo_bajas where equipo_id = $1', [equipo.id])
  comprobar(
    historia?.motivo === 'Se quemó el motor y no tiene arreglo' && historia?.baja_por === mantenimiento
      && historia?.reactivado_por === mantenimiento && historia?.reactivacion_motivo === 'Se reparó el motor en el taller',
    'la baja y la reactivación quedan en la historia del equipo, con quién y por qué',
  )
  const dichoReactivar = (await pagina.getByRole('status').filter({ hasText: /reactivado/ }).first().innerText().catch(() => '')).trim()
  comprobar(dichoReactivar.includes(equipo.codigo), `y la pantalla lo dice: «${dichoReactivar}»`)

  // Una categoría más.
  await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
  await pagina.getByRole('button', { name: 'Categorías' }).click()
  const categorias = ventana(pagina)
  // Siempre la misma: una categoría no se borra, y una por corrida llenaba el
  // desplegable del alta. La primera vez se crea; después se prueba el rechazo.
  const nombreCategoria = 'Compresor de prueba QA'
  const prefijo = 'QACMP'
  const yaEstaba = (await una('select count(*)::int as n from public.equipo_categorias where nombre = $1', [nombreCategoria])).n > 0
  await categorias.getByLabel('Nueva categoría').fill(nombreCategoria)
  await categorias.getByLabel('Prefijo').fill(prefijo.toLowerCase())
  await categorias.getByRole('button', { name: 'Agregar categoría' }).click()
  if (yaEstaba) {
    const rechazo = categorias.getByRole('alert')
    await rechazo.first().waitFor({ timeout: 20000 }).catch(() => {})
    comprobar(/Ya hay una categoría con ese nombre/.test(await rechazo.first().innerText().catch(() => '')), 'una categoría repetida se rechaza diciendo por qué')
    comprobar((await una('select count(*)::int as n from public.equipo_categorias where nombre = $1', [nombreCategoria])).n === 1, 'y no entra otra')
  } else {
    await categorias.getByText(nombreCategoria).first().waitFor({ timeout: 20000 }).catch(() => {})
    const nueva = await una('select prefijo from public.equipo_categorias where nombre = $1', [nombreCategoria])
    comprobar(nueva?.prefijo === prefijo, `«Agregar categoría» la crea con su prefijo en mayúsculas (${nueva?.prefijo})`)
  }

  comprobar(errores.length === 0, `sin errores de consola como Mantenimiento ${errores.join(' | ')}`)
  await contexto.close()

  // -------------------------------------------------------------------------
  // Almacén solo cambia quién lo tiene
  // -------------------------------------------------------------------------
  {
    const { pagina, contexto, errores } = await entrar('almacen.local@metalwork.test')
    const menu = (await pagina.locator('nav').first().innerText()).replace(/\s+/g, ' ')
    comprobar(/Equipos/.test(menu), 'el menú de Almacén trae «Equipos»')
    await pagina.goto(`${BASE}/equipos?q=${encodeURIComponent(equipo.codigo)}`, { waitUntil: 'networkidle' })
    const principal = pagina.locator('main')
    comprobar((await principal.getByRole('button', { name: 'Nuevo equipo' }).count()) === 0, 'Almacén no tiene «Nuevo equipo»')
    comprobar(
      (await principal.getByRole('button', { name: /^(Estado de|Editar) / }).count()) === 0,
      'ni «Estado» ni «Editar» en las filas',
    )
    await pagina.getByRole('button', { name: `A cargo de ${equipo.codigo}` }).click()
    const cargo = ventana(pagina)
    await cargo.getByLabel('A cargo de', { exact: true }).fill('contratista de prueba')
    await cargo.getByRole('button', { name: 'Guardar' }).click()
    await cerrada(pagina)
    const despues = await una('select a_cargo_de, ubicacion, estado, descripcion from public.equipos where id = $1', [equipo.id])
    comprobar(despues.a_cargo_de === 'CONTRATISTA DE PRUEBA', `Almacén cambia quién lo tiene (${despues.a_cargo_de})`)
    comprobar(despues.ubicacion === 'Nave 2, puesto 4' && despues.estado === 'PARADO' && despues.descripcion === descripcion, 'y nada más del equipo cambia')
    comprobar(/CONTRATISTA DE PRUEBA/.test(await pagina.locator('tr', { hasText: equipo.codigo }).innerText()), 'la fila ya lo muestra')
    comprobar(errores.length === 0, `sin errores de consola como Almacén ${errores.join(' | ')}`)
    await contexto.close()
  }

  // -------------------------------------------------------------------------
  // Gerencia consulta
  // -------------------------------------------------------------------------
  {
    const { pagina, contexto, errores } = await entrar('gerencia.local@metalwork.test')
    await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
    const principal = pagina.locator('main')
    const texto = (await principal.innerText()).replace(/\s+/g, ' ')
    comprobar(new URL(pagina.url()).pathname === '/equipos' && texto.includes(equipo.codigo), 'Gerencia abre el padrón y lo lee')
    const suyos = await principal.getByRole('button').evaluateAll((bs) =>
      bs.filter((b) => b.offsetParent !== null).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim()),
    )
    const escriben = suyos.filter((n) => /^(Nuevo|Categor|Estado|Editar|Cambiar|Dar de baja|Reactivar)/.test(n))
    comprobar(escriben.length === 0, `y no tiene botones que escriban${escriben.length ? `: ${escriben.join(', ')}` : ''}`)
    comprobar(errores.length === 0, `sin errores de consola como Gerencia ${errores.join(' | ')}`)
    await contexto.close()
  }

  // -------------------------------------------------------------------------
  // Ventas no entra
  // -------------------------------------------------------------------------
  {
    const { pagina, contexto } = await entrar('ventas.local@metalwork.test')
    const menu = (await pagina.locator('nav').first().innerText()).replace(/\s+/g, ' ')
    comprobar(!/Equipos/.test(menu), 'el menú de Ventas no trae «Equipos»')
    await pagina.goto(`${BASE}/equipos`, { waitUntil: 'networkidle' })
    comprobar(new URL(pagina.url()).pathname === '/sin-permiso', `Ventas no entra a /equipos (va a ${new URL(pagina.url()).pathname})`)
    await contexto.close()
  }

  // -------------------------------------------------------------------------
  // En el teléfono del taller
  // -------------------------------------------------------------------------
  {
    const { pagina, contexto, errores } = await entrar('mantenimiento.local@metalwork.test', true)
    await pagina.goto(`${BASE}/equipos?estado=parados`, { waitUntil: 'networkidle' })
    const desborde = await pagina.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    comprobar(desborde <= 0, `a 390 la lista no se corre de lado (${desborde} px)`)
    const filaTelefono = pagina.locator('tr', { hasText: equipo.codigo })
    comprobar(/Parado/.test(await filaTelefono.innerText()) && /No enciende/.test(await filaTelefono.innerText()), 'y la fila dice el estado y qué tiene')
    await pagina.screenshot({ path: join(CAPTURAS, 'equipos-parados-390.png'), fullPage: true })
    comprobar(errores.length === 0, `sin errores de consola en el teléfono ${errores.join(' | ')}`)
    await contexto.close()
  }
}

await navegador.close()
await base.end()
console.log(fallas.length ? `\n${fallas.length} comprobación(es) fallaron.` : '\nTodo bien: Mantenimiento lleva el padrón, Almacén anota quién tiene cada equipo, Gerencia consulta y los demás no entran.')
process.exit(fallas.length ? 1 : 0)
