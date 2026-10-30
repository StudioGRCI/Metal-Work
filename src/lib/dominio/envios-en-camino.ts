/**
 * La cuenta de lo que está en camino, que «Volver a cargar» espera
 * (`mientrasSeEnvia` y `volverACargar`, en `@/lib/envio`). Aparte, sin React ni
 * Next, para probarla sola (`envios-en-camino.test.mjs`).
 *
 * Cada envío lleva un número que solo crece. Lo que el aviso ofreció no esperar
 * («Volver a cargar igual»: lo que no contestaba a los 10 s, lo que volvió sin
 * entrar, la ida que tarda) llega hasta `ofrecidoHasta`; lo que sale después se
 * espera igual. Antes `igual` no esperaba nada: tras un «no entró», el reenvío
 * corregido recargaba a los 160 ms y dejaba su PDF suelto (F3 de la crítica de
 * la trigesimocuarta pasada).
 */
export function cuentaDeEnvios() {
  let iniciados = 0
  const enCamino = new Set<number>()
  let esperan: Array<{ desde: number; listo: () => void }> = []
  // Las esperas de ahora: si alguno de los que espera cada una vuelve sin
  // entrar, esa no recarga. Puede haber dos: la que sigue tras los 10 s y la de
  // «Volver a cargar igual».
  const esperas = new Set<{ desde: number; noEntro: boolean }>()
  let ofrecidoHasta = 0
  const faltan = (desde: number) => [...enCamino].some((id) => id > desde)

  return {
    /** Sale un envío. Devuelve con qué decir que volvió, y si entró. */
    salir() {
      const id = ++iniciados
      enCamino.add(id)
      return (entro: boolean) => {
        if (!enCamino.delete(id)) return
        if (!entro) for (const e of esperas) if (id > e.desde) e.noEntro = true
        const antes = esperan
        esperan = []
        for (const e of antes) {
          if (faltan(e.desde)) esperan.push(e)
          else e.listo()
        }
      }
    },

    /**
     * Espera a que vuelva lo que está en camino; con `igual`, solo lo que salió
     * después de lo ofrecido. A los `tope` ms, `alTardar`, y lo que todavía no
     * vuelve pasa a ser lo ofrecido. Dice si algo de lo que esperó no entró.
     */
    async esperar({ igual = false, alTardar, tope = 10_000 }: { igual?: boolean; alTardar?: () => void; tope?: number } = {}) {
      const esta = { desde: igual ? ofrecidoHasta : 0, noEntro: false }
      esperas.add(esta)
      const tarda = setTimeout(() => {
        ofrecidoHasta = iniciados
        alTardar?.()
      }, tope)
      try {
        if (faltan(esta.desde)) await new Promise<void>((listo) => esperan.push({ desde: esta.desde, listo }))
      } finally {
        clearTimeout(tarda)
        esperas.delete(esta)
      }
      return esta.noEntro
    },

    /** El aviso ofrece no esperar lo que ya salió («Volver a cargar igual»). */
    ofrecer() {
      ofrecidoHasta = iniciados
    },
  }
}
