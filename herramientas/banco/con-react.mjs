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
 * (ingresar) espera a los controles de la página: el clic de «Ingresar» antes de
 * hidratar se perdía y la suite caía con «No se pudo entrar…» (vigésima pasada).
 * Si la pantalla redirige ya en el navegador, la espera vuelve a empezar en la
 * página de llegada: antes caía con «Execution context was destroyed».
 */
export async function conReact(pagina, ms = 60000) {
  const limite = Date.now() + ms
  for (;;) {
    try {
      await pagina.waitForFunction(() => {
        const raiz = document.querySelector('main') ?? document.body
        if (!raiz) return false
        const tomado = (el) => Object.keys(el).some((k) => k.startsWith('__reactFiber'))
        return tomado(raiz) && [...raiz.querySelectorAll('button, input, select, textarea, a[href], summary')].every(tomado)
      }, null, { timeout: Math.max(1000, limite - Date.now()), polling: 100 })
      // Lo hidratado se confirma en el cuadro siguiente.
      await pagina.evaluate(() => new Promise((listo) => requestAnimationFrame(() => requestAnimationFrame(listo))))
      return
    } catch (e) {
      if (/Execution context was destroyed|navigat/i.test(e.message) && Date.now() < limite) {
        await pagina.waitForLoadState('domcontentloaded').catch(() => {})
        continue
      }
      const como = await pagina.evaluate(() => ({
        ruta: location.pathname + location.search,
        mains: document.querySelectorAll('main').length,
        claves: Object.keys(document.querySelector('main') ?? document.body ?? {}).join(',') || 'ninguna',
        estado: document.readyState,
      })).catch(() => null)
      throw new Error(`React no tomó la pantalla en ${ms / 1000} s: ${JSON.stringify(como)} (${e.message.split('\n')[0]})`)
    }
  }
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
