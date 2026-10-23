/**
 * Que la prueba toque la pantalla cuando React ya la tomó.
 *
 * `networkidle` no quiere decir que la pantalla responda. Con la lista larga de
 * Tesorería del banco (más de 200 facturas que dejaron las corridas anteriores)
 * React todavía no había hidratado: el toque a «Registrar pago» caía antes que
 * él, se perdía y la ventana no se abría (2026-10-23). Se espera a que React
 * haya tomado cada control de <main>, no solo <main>: lo que llega en partes
 * (Suspense) se hidrata después, y una captura en ese momento le pone al campo
 * enfocado un `caret-color` que React no reconoce. La pantalla sin <main>
 * (ingresar) no espera.
 */
export async function conReact(pagina, ms = 60000) {
  await pagina.waitForFunction(() => {
    const main = document.querySelector('main')
    if (!main) return true
    const tomado = (el) => Object.keys(el).some((k) => k.startsWith('__reactFiber'))
    return tomado(main) && [...main.querySelectorAll('button, input, select, textarea, a[href], summary')].every(tomado)
  }, null, { timeout: ms, polling: 100 }).catch(async (e) => {
    const como = await pagina.evaluate(() => ({
      ruta: location.pathname + location.search,
      mains: document.querySelectorAll('main').length,
      claves: Object.keys(document.querySelector('main') ?? {}).join(',') || 'ninguna',
      estado: document.readyState,
    })).catch(() => null)
    throw new Error(`React no tomó la pantalla en ${ms / 1000} s: ${JSON.stringify(como)} (${e.message.split('\n')[0]})`)
  })
  // Lo hidratado se confirma en el cuadro siguiente.
  await pagina.evaluate(() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo))))
}

/** Cada `goto` y `reload` de la página espera a React (`conReact`). */
export function esperarReactAlNavegar(pagina) {
  for (const metodo of ['goto', 'reload']) {
    const original = pagina[metodo].bind(pagina)
    pagina[metodo] = async (...argumentos) => {
      const respuesta = await original(...argumentos)
      await conReact(pagina)
      return respuesta
    }
  }
  return pagina
}
