/**
 * Las `Ventana` abiertas, y lo que espera a que se cierren.
 *
 * Tras «… ya quedó registrado la primera vez que lo enviaste», la pantalla de
 * detrás se pone al día para no ofrecer otra vez lo que ya entró. Si lo hacía
 * con la ventana abierta y el primer envío ya había quitado el botón que la
 * abrió (el vehículo ya salió, la factura quedó pagada, la guía cargada), la
 * ventana se desmontaba sola en menos de un segundo: el aviso no se alcanzaba a
 * leer y las fotos nuevas de la salida quedaban sueltas en Storage
 * (decimotercera pasada). Ahora se pone al día cuando la persona la cierra, con
 * «Cerrar», la X o Escape. La ventana es modal: la página de detrás no se toca
 * mientras tanto.
 */
const abiertas = new Set<object>()
let pendientes: Array<() => void> = []
let cerradas = 0
// Cuándo se cerró (`performance.now()`), por las veces que se había cerrado antes:
// lo que la persona tocó después es de otra cosa (`laIdaSigueEnPie`).
const cierres = new Map<number, number>()

export function abrioVentana(marca: object) {
  abiertas.add(marca)
}

export function cerroVentana(marca: object) {
  if (!abiertas.delete(marca) || abiertas.size > 0) return
  cierres.set(cerradas, performance.now())
  cierres.delete(cerradas - 100)
  cerradas++
  const ahora = pendientes
  pendientes = []
  for (const hacer of ahora) hacer()
}

export const hayVentanaAbierta = () => abiertas.size > 0

/** La última que se abrió: la que está encima. */
export const esLaUltimaVentana = (marca: object) => [...abiertas].at(-1) === marca

/**
 * Cuántas veces se cerró la última ventana. Si cambió desde un envío, su
 * ventana ya no está aunque haya otra abierta: se canceló mientras se enviaba
 * y se volvió a abrir antes de que llegara la respuesta.
 */
export const vecesQueSeCerro = () => cerradas

/** Cuándo se cerró la ventana que estaba abierta tras `veces` cierres (`vecesQueSeCerro()` de entonces), o `null`. */
export const cuandoSeCerro = (veces: number) => cierres.get(veces) ?? null

/** Deja `hacer` para cuando se cierre la última ventana. Sin ventana abierta no lo deja y dice que no. */
export function alCerrarLaVentana(hacer: () => void): boolean {
  if (abiertas.size === 0) return false
  pendientes.push(hacer)
  return true
}
