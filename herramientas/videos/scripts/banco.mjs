/**
 * La base del banco local, para lo que un video siembra fuera de cámara.
 *
 *   const b = await conectar()
 *   await b.como('sup.mtz', 'select public.algo($1)', [valor])   // con la sesión del puesto
 *   await b.cerrar()
 *
 * `como` corre el SQL con la sesión de la cuenta de prueba del puesto, con su
 * rol y su permiso (nunca como dueño de las tablas): si el puesto no puede
 * hacerlo en la pantalla, tampoco puede aquí. `consulta` es para leer o para
 * lo que en la empresa es configuración (quién responde por un área).
 */
import { writeFileSync } from 'node:fs'

import pg from 'pg'

export const cuentaDe = (puesto) => `${puesto}.local@metalwork.test`

export async function conectar() {
  const base = new pg.Client({
    host: process.env.PGHOST ?? '/tmp',
    port: Number(process.env.PGPORT ?? 5433),
    user: process.env.PGUSER ?? 'postgres',
    database: process.env.BANCO_BASE ?? 'mw_demo',
  })
  await base.connect()
  const consulta = async (sql, valores = []) => (await base.query(sql, valores)).rows
  const idDe = async (puesto) => {
    const [u] = await consulta('select id::text from public.usuarios where correo = $1', [cuentaDe(puesto)])
    if (!u) throw new Error(`Falta la cuenta ${cuentaDe(puesto)}: corre antes preparar.sh.`)
    return u.id
  }
  async function como(puesto, sql, valores = []) {
    const yo = await idDe(puesto)
    await base.query('begin')
    try {
      await base.query(
        `select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claim.role', 'authenticated', true),
                set_config('request.jwt.claims', json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
        [yo],
      )
      await base.query('set local role authenticated')
      const filas = await consulta(sql, valores)
      await base.query('commit')
      return filas
    } catch (e) {
      await base.query('rollback')
      throw e
    }
  }
  return { consulta, idDe, como, cerrar: () => base.end() }
}

/** Una foto inventada (un color liso con un rótulo), para la tarea que pide una. */
export async function fotoInventada(pagina, ruta, rotulo, color = '#5b6b78') {
  const b64 = await pagina.evaluate(
    async ([texto, fondo]) => {
      const c = document.createElement('canvas')
      c.width = 800
      c.height = 600
      const g = c.getContext('2d')
      g.fillStyle = fondo
      g.fillRect(0, 0, 800, 600)
      // Centrado: la miniatura de la pantalla recorta la foto en cuadrado.
      g.fillStyle = '#fff'
      g.font = '34px sans-serif'
      g.textAlign = 'center'
      texto.split('\n').forEach((linea, i) => g.fillText(linea, 400, 280 + i * 46))
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9))
      const b = new Uint8Array(await blob.arrayBuffer())
      let s = ''
      for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
      return btoa(s)
    },
    [rotulo, color],
  )
  writeFileSync(ruta, Buffer.from(b64, 'base64'))
  return ruta
}
