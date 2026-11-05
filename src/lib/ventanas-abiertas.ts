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
  // Lo que la trababa era de esta vez: cerrada, se suelta (`trabarLaVentana`).
  if (trabas.delete(marca)) avisarTrabas()
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

/**
 * Lo que la ventana de encima no deja o dice mientras un envío suyo termina.
 * `trabada`: no se cierra —ni «Cancelar», ni la X, ni Escape, ni el fondo—,
 * porque corrige lo que la pantalla muestra y, vuelta a abrir antes de que la
 * pantalla se ponga al día, traía lo de antes (`corrige` de `useAccion`).
 * `guardado`: lo enviado ya entró y la ventana espera a la pantalla al día para
 * cerrarse; la ventana lo dice, y el botón que gira ya no parece colgado.
 * `mirando`: no se sabe si entró («No llegó la respuesta», el 502) y la pantalla
 * se pone al día con la ventana abierta, para que diga si quedó y la ventana
 * vuelta a abrir no traiga lo de antes.
 * `preguntando`: antes de eso, se pregunta si el servidor contesta (hasta 3 s);
 * la ventana lo dice, y el botón que gira con el aviso rojo no parece colgado
 * (H4 de funcionalidad, quincuagésima cuarta pasada).
 */
export type TrabaDeLaVentana = { trabada: boolean; guardado: boolean; mirando?: boolean; preguntando?: boolean }

const trabas = new Map<object, Set<TrabaDeLaVentana>>()
const alCambiarLasTrabas = new Set<() => void>()

function avisarTrabas() {
  anotarLaPuestaAlDia()
  for (const avisar of alCambiarLasTrabas) avisar()
}

// El título de cada ventana, para nombrar la que se llevó la recarga (`nombrarVentana`).
const titulos = new WeakMap<object, string>()

/** Cómo se llama la ventana: lo que dice arriba si la recarga del documento se la lleva. */
export function nombrarVentana(marca: object, titulo: string) {
  titulos.set(marca, titulo)
}

/**
 * Mientras la pantalla se pone al día con la ventana abierta y sin saber si lo
 * enviado entró (`mirando`), la pestaña lo anota. Que el servidor conteste
 * (`sePuedePonerAlDia`) no quiere decir que la página llegue: si la acción
 * volvió con un 502 y la página también, Next recarga el documento entero y
 * se lleva la ventana con lo escrito. Nada decía que no había entrado, y la
 * ventana que se cierra sola parecía guardada (G1 de la crítica, quincuagésima
 * quinta pasada). La pantalla nueva lo lee y lo dice arriba
 * (`laRecargaSeLlevoLaVentana`). Lo escrito no se guarda en la pestaña: cada
 * ventana tendría que saber volver a llenar sus campos.
 */
const SE_PONIA_AL_DIA = 'metal-work:al-dia-con-la-ventana'
// Solo quita lo anotado por esta pantalla: al nacer, la pantalla que viene de
// la recarga no tiene trabas, y no tiene que borrar lo que la anterior dejó.
let anotada = false
// Lo que se pone al día sin su ventana a la vista (`anotarQueSePoneAlDia`).
const sinVentana = new Set<{ que: string }>()

function anotarLaPuestaAlDia() {
  let anotado: { titulo: string } | { que: string } | null = null
  for (const [marca, suyas] of trabas) if ([...suyas].some((t) => t.mirando)) anotado = { titulo: titulos.get(marca) ?? '' }
  if (anotado === null) for (const { que } of sinVentana) anotado = { que }
  if (anotado === null && !anotada) return
  try {
    if (anotado === null) sessionStorage.removeItem(SE_PONIA_AL_DIA)
    else sessionStorage.setItem(SE_PONIA_AL_DIA, JSON.stringify({ ...anotado, ruta: location.pathname + location.search, en: Date.now() }))
  } catch {}
  anotada = anotado !== null
}

/**
 * Lo mismo que la traba `mirando`, para lo que se pone al día sin su ventana a
 * la vista: un formulario en línea que corrige su tarjeta (la nota del paso),
 * o el envío cuya ventana se cerró en vuelo con su formulario aún montado (el
 * desmontado no anota: nadie lo soltaría). Una recarga entera se llevaba
 * lo escrito sin decir nada (D de funcionalidad, quincuagésima sexta pasada).
 * `que`: cómo se llama lo enviado («la nota», «lo que enviaste»). Se quita
 * llamando a lo que devuelve.
 */
export function anotarQueSePoneAlDia(que: string): () => void {
  const esta = { que }
  sinVentana.add(esta)
  anotarLaPuestaAlDia()
  return () => {
    if (sinVentana.delete(esta)) anotarLaPuestaAlDia()
  }
}

/**
 * Lo que se ponía al día cuando el documento se recargó: el título de su
 * ventana, o qué era si no la tenía a la vista (`que`), y la dirección de su
 * pantalla. Se lee una vez, al nacer la pantalla. Lo anotado hace más de diez
 * minutos ya no es de esta recarga.
 */
export function laRecargaSeLlevoLaVentana(): { titulo: string; que?: string; ruta: string } | null {
  try {
    const anotado = sessionStorage.getItem(SE_PONIA_AL_DIA)
    if (!anotado) return null
    sessionStorage.removeItem(SE_PONIA_AL_DIA)
    const { titulo, que, ruta, en } = JSON.parse(anotado) as { titulo?: unknown; que?: unknown; ruta?: unknown; en?: unknown }
    if ((typeof titulo !== 'string' && typeof que !== 'string') || typeof ruta !== 'string' || typeof en !== 'number') return null
    if (!ruta.startsWith('/') || ruta.startsWith('//') || Date.now() - en > 10 * 60_000) return null
    return typeof que === 'string' ? { titulo: '', que, ruta } : { titulo: titulo as string, ruta }
  } catch {
    return null
  }
}

/** Traba la ventana de encima hasta que se llame lo que devuelve, o hasta que se cierre. */
export function trabarLaVentana(traba: TrabaDeLaVentana): () => void {
  const marca = [...abiertas].at(-1)
  if (!marca) return () => {}
  let suyas = trabas.get(marca)
  if (!suyas) trabas.set(marca, (suyas = new Set()))
  const esta = { ...traba }
  suyas.add(esta)
  avisarTrabas()
  return () => {
    if (!suyas.delete(esta)) return
    if (suyas.size === 0 && trabas.get(marca) === suyas) trabas.delete(marca)
    avisarTrabas()
  }
}

export function vigilarLasTrabas(avisar: () => void) {
  alCambiarLasTrabas.add(avisar)
  return () => void alCambiarLasTrabas.delete(avisar)
}

/** Cómo está trabada esa ventana: un número para que `useSyncExternalStore` lo compare (2, trabada; 1, guardado; 4, mirando; 8, preguntando). */
export function trabaDe(marca: object): number {
  let traba = 0
  for (const t of trabas.get(marca) ?? []) traba |= (t.trabada ? 2 : 0) | (t.guardado ? 1 : 0) | (t.mirando ? 4 : 0) | (t.preguntando ? 8 : 0)
  return traba
}
