import { unstable_isUnrecognizedActionError, unstable_rethrow, useRouter } from 'next/navigation'
import { startTransition, useEffect, useId, useRef, useState, useSyncExternalStore, useTransition, type FormEvent } from 'react'

import { consultarEnvio } from '@/app/(app)/acciones-envio'
import { pudoHaberEntrado, yaEntroLaPrimeraVez, type ResultadoAccion } from '@/lib/acciones'
import { contarLoQueEntro, MAXIMO_PENDIENTES, type ClaveDelEnvio, type LoQueEntro } from '@/lib/dominio/envios'
import { cuentaDeEnvios } from '@/lib/dominio/envios-en-camino'
import { alCerrarLaVentana, cuandoSeCerro, hayVentanaAbierta, vecesQueSeCerro } from '@/lib/ventanas-abiertas'

type Exito<T> = Extract<ResultadoAccion<T>, { ok: true }>

/**
 * Lo que se dice cuando la acción no contesta: se cortó la señal, o el
 * servidor cayó a medio camino. La escritura pudo entrar igual, así que se pide
 * mirar antes de repetirla.
 */
export const SIN_RESPUESTA = 'No llegó la respuesta. Revisa la conexión y mira si quedó guardado antes de volver a intentar.'

/**
 * Con lo que se frena el envío desde una pantalla que es de otra cuenta
 * (`laPestanaEsDeOtraCuenta`). Si frena el primer toque (`salio()`), en
 * `useAccion` no se dice: no salió nada, y lo dice la traba de la pantalla, que
 * se abre al mismo tiempo. Si corta una cadena a medias (subir y anotar), sí:
 * `NO_SE_GUARDO_OTRA_CUENTA`.
 */
export class OtraCuentaEnLaPestana extends Error {
  constructor() {
    super('No se envió: esta pantalla es de otra cuenta. Vuelve a entrar con la tuya en la otra pestaña, o recarga.')
  }
}

/**
 * La pestaña es de antes del último despliegue y el servidor ya no conoce el id
 * de la acción que manda esta pantalla (404 con `x-nextjs-action-not-found`). Ese
 * id no cambia en cada despliegue: es un hash con una clave que Next guarda en
 * `.next/cache` y rota cada catorce días, y cambia también si la acción cambia
 * de archivo o de nombre. La acción no corrió, así que no entró, y reintentar
 * desde aquí no sirve: hay que recargar.
 */
export const SE_ACTUALIZO_EL_SISTEMA = 'El sistema se actualizó mientras tenías la pantalla abierta. Copia lo escrito y vuelve a cargar la pantalla.'

/** La fila de una tanda que no salió por eso: la causa la dice una sola vez el resumen. */
export const NO_SALIO_SE_ACTUALIZO = 'No salió: el sistema se actualizó.'

/**
 * Lo que la pestaña sabe del despliegue con que se pintó:
 *
 * · `al-dia`: contesta el mismo servidor.
 * · `nueva`: hubo un despliegue. Lo sabe `RefrescoAlVolver`, que compara la
 *   compilación con que se pintó la pantalla con la del servidor que contesta.
 *   Las acciones suelen seguir existiendo, pero `router.refresh()` ya no
 *   repinta: Next ve otra compilación y recarga el documento entero. Se llevaba
 *   lo escrito y dejaba suelta la foto ya subida del reporte diario, en el
 *   despliegue de todos los días, que conserva los ids (crítica de la trigésima
 *   pasada; la vigesimonovena solo miraba la acción desconocida).
 * · `vieja`: además, una acción contestó que no existe. Nada de lo que se envíe
 *   desde aquí entra.
 *
 * `callado`: lo supo un envío que ya lo dice junto a su botón, y el aviso de
 * arriba no lo anuncia otra vez (trigésima pasada).
 */
export type VersionDeLaPestana = { estado: 'al-dia' | 'nueva' | 'vieja'; callado: boolean }
const AL_DIA: VersionDeLaPestana = { estado: 'al-dia', callado: false }
let version = AL_DIA
const alCambiarLaVersion = new Set<() => void>()

function anotarVersion(siguiente: VersionDeLaPestana) {
  version = siguiente
  for (const avisar of alCambiarLaVersion) avisar()
}

/**
 * Si `e` es la acción que el servidor ya no conoce (`unstable_isUnrecognizedActionError`),
 * y de paso deja anotado que esta pestaña es de antes del despliegue. Todo
 * `catch` que lo mire pasa por aquí, no por la función de Next. Con
 * `sinAvisoPropio` (el refresco al volver, la pregunta al abrir una ventana),
 * quien llama no dice nada: lo anuncia la ventana abierta, si la hay
 * (`SeActualizoEnLaVentana`), o el aviso de arriba.
 */
export function esDeLaVersionAnterior(e: unknown, { sinAvisoPropio = false } = {}) {
  if (!unstable_isUnrecognizedActionError(e)) return false
  if (version.estado !== 'vieja') anotarVersion({ estado: 'vieja', callado: !sinAvisoPropio })
  return true
}

/** Hubo un despliegue desde que se pintó la pantalla (`RefrescoAlVolver`). */
export function anotarQueHuboUnDespliegue() {
  if (version.estado === 'al-dia') anotarVersion({ estado: 'nueva', callado: false })
}

export const laPestanaEsDeLaVersionAnterior = () => version.estado === 'vieja'

/** Hubo un despliegue: aquí `router.refresh()` recargaría el documento entero. */
export const laPestanaEsDeOtroDespliegue = () => version.estado !== 'al-dia'

/**
 * La compilación con que se pintó la pantalla (la anota `RefrescoAlVolver`). La
 * lleva la acción que, si el servidor es de otro despliegue, no revalida: ahí
 * Next recargaría el documento entero (`marcarAvisoLeido`).
 */
let compilacionDeLaPestana: string | null = null

export function anotarLaCompilacionDeLaPestana(compilacion: string | null) {
  compilacionDeLaPestana ??= compilacion
}

export const laCompilacionDeLaPestana = () => compilacionDeLaPestana

/** Avisa cada vez que cambia lo que la pestaña sabe del despliegue. Devuelve con qué dejar de avisar. */
export const vigilarLaVersion = (avisar: () => void) => {
  alCambiarLaVersion.add(avisar)
  return () => void alCambiarLaVersion.delete(avisar)
}

export function useVersionDeLaPestana() {
  return useSyncExternalStore(vigilarLaVersion, () => version, () => AL_DIA)
}

export function usePestanaDeLaVersionAnterior() {
  return useVersionDeLaPestana().estado === 'vieja'
}

/**
 * Lo que una pantalla quita antes de que «Volver a cargar», el del aviso de
 * arriba, recargue: la foto ya subida del reporte diario, que después de
 * recargar no la nombraría nadie (trigésima pasada). Devuelve con qué dejar de
 * pedirlo.
 */
const antesDeRecargar = new Set<() => unknown>()

export function alVolverACargar(quitar: () => unknown) {
  antesDeRecargar.add(quitar)
  return () => void antesDeRecargar.delete(quitar)
}

/**
 * Los envíos que todavía no vuelven (`mientrasSeEnvia`). «Volver a cargar» los
 * espera: con el reporte diario en camino quitaba la foto que ese envío
 * nombraba, el reporte no entraba y la pantalla recargaba vacía, sin aviso; y
 * si entraba, la pantalla vacía invitaba a subirlo otra vez (trigesimoprimera
 * pasada).
 */
const envios = cuentaDeEnvios()
const alEmpezar = new Set<() => void>()
// Quien pinta cuántos van en camino (`useEnviosEnCamino`): se le avisa cuando sale o vuelve uno.
const alCambiarLosEnvios = new Set<() => void>()
const avisarQueCambiaron = () => {
  for (const avisar of alCambiarLosEnvios) avisar()
}

/** Avisa cada vez que sale un envío (`mientrasSeEnvia`). Devuelve con qué dejar de avisar. */
export function alEmpezarUnEnvio(avisar: () => void) {
  alEmpezar.add(avisar)
  return () => void alEmpezar.delete(avisar)
}

/**
 * `enviar` llama a `entro()` cuando lo enviado entró: con un rechazo, sin
 * respuesta o con un error, «Volver a cargar» no recarga encima de su aviso
 * (trigesimosegunda pasada). Lo que sale después de un «no entró» se espera
 * también con «Volver a cargar igual» (`cuentaDeEnvios`). `noEntro(motivo)`,
 * para el rechazo que no se dice en ningún otro lado: el aviso de arriba lo
 * dice en vez de mandar a leer uno que no existe (funcionalidad H1 de la
 * trigesimoquinta pasada).
 */
export async function mientrasSeEnvia<T>(enviar: (entro: () => void, noEntro: (motivo: string) => void) => Promise<T>, de?: DeFormulario): Promise<T> {
  // El rechazo de arriba es de este formulario (`de`), que sale otra vez: lo
  // que conteste ahora lo dice él. El envío de otro formulario de la misma
  // pantalla no lo quita: una ventana rechazada en la orden nueva se llevaba el
  // motivo de la orden (H2 de funcionalidad, cuadragésima segunda pasada).
  if (de && idaQueNoSalio?.rechazo && esDelFormulario(idaQueNoSalio, de)) ponerIdaQueNoSalio(null)
  const volvio = envios.salir()
  for (const avisar of alEmpezar) avisar()
  avisarQueCambiaron()
  let entro = false
  let motivo: string | null = null
  try {
    return await enviar(
      () => {
        entro = true
      },
      (porque) => {
        motivo = porque
      },
    )
  } finally {
    volvio(entro, motivo)
    avisarQueCambiaron()
  }
}

/**
 * Las acciones cuyo desenlace con la ventana cerrada ya se dice junto al botón
 * que la abre (`useFotosDelEnvio`): `useAccion` no se lo da al aviso de arriba.
 */
const seDiceJuntoAlBoton = new WeakSet<object>()

export function dichoJuntoAlBoton<F extends object>(accion: F): F {
  seDiceJuntoAlBoton.add(accion)
  return accion
}

/**
 * Cuántos envíos siguen en camino (`mientrasSeEnvia`), contando el que pregunta
 * si va dentro de uno.
 */
export const enviosEnCamino = () => envios.cuantos()

/**
 * `enviosEnCamino()` en la pantalla, que se vuelve a pintar cuando sale o
 * vuelve uno. La navegación de Next espera a los que van en transición: «Ver su
 * tarjeta» se apaga mientras haya alguno (Z2 de la crítica de la trigesimoséptima pasada).
 */
export function useEnviosEnCamino() {
  return useSyncExternalStore(
    (avisar) => {
      alCambiarLosEnvios.add(avisar)
      return () => void alCambiarLosEnvios.delete(avisar)
    },
    enviosEnCamino,
    () => 0,
  )
}

// La última vez que la persona tocó la pantalla o una tecla, y la última que
// pidió ir a otro lado (un enlace del menú o de una pastilla, un aviso de la
// campana): lo que hizo después de que saliera un envío manda sobre la ida que
// el envío haría solo al entrar (`laIdaSigueEnPie`).
let tocoEn = -1
let pidioIrEn = -1
if (typeof window !== 'undefined') {
  const anotar = () => {
    tocoEn = performance.now()
  }
  for (const tipo of ['pointerdown', 'keydown'] as const) window.addEventListener(tipo, anotar, true)
  // Pedir otra pantalla es el clic que la abre en esta pestaña, también el de
  // Enter y el de un lector de pantalla, que llega sin pointerdown. No lo es el
  // dedo que desplaza empezando sobre un enlace, que no termina en clic
  // (funcionalidad H2 de la trigesimonovena pasada), ni el clic derecho (X1 de
  // su crítica), ni el que abre otra pestaña o un enlace a esta misma pantalla:
  // la persona sigue aquí, esperando el envío.
  window.addEventListener(
    'click',
    (e) => {
      anotar()
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
      const enlace = e.target instanceof Element ? e.target.closest('a[href]') : null
      if (!(enlace instanceof HTMLAnchorElement) || enlace.hasAttribute('download') || (enlace.target && enlace.target !== '_self')) return
      const destino = new URL(enlace.href)
      if (destino.origin === location.origin && destino.pathname === location.pathname && destino.search === location.search) return
      pidioIrEn = tocoEn
    },
    true,
  )
}

/** La última vez que la persona tocó la pantalla o una tecla (`performance.now()`). */
export const ultimoToque = () => tocoEn

/**
 * Pedir otra pantalla sin un enlace: un aviso de la campana es un botón que
 * marca el aviso y después lleva a su pantalla. No contaba, y la ida del
 * formulario que estaba entrando salía, se llevaba la línea y la del aviso la
 * pisaba: la persona terminaba en el aviso sin saber que lo suyo había entrado
 * (X2 de la crítica de la cuadragésima pasada).
 */
export function anotarQuePidioIr() {
  tocoEn = performance.now()
  pidioIrEn = tocoEn
}

/** Cómo estaba la pestaña cuando salió un envío que, si entra, lleva a otra pantalla (`partida()`). */
export type Partida = { direccion: string; salioEn: number; ventana: number | null }

export function partida(): Partida {
  return {
    direccion: window.location.pathname + window.location.search,
    salioEn: performance.now(),
    ventana: hayVentanaAbierta() ? vecesQueSeCerro() : null,
  }
}

/** La persona sigue en la dirección de donde salió el envío: «Atrás», un filtro o una búsqueda la cambian. */
export const sigueDondeSalio = (desde: Partida) => window.location.pathname + window.location.search === desde.direccion

/**
 * Desde que salió el envío, la persona se fue o pidió irse: cambió la dirección,
 * o tocó un enlace o un aviso, que Next deja en cola hasta que el envío vuelve.
 */
export const pidioOtraPantalla = (desde: Partida) => !sigueDondeSalio(desde) || pidioIrEn > desde.salioEn

/**
 * Si la ida que un envío hace solo al entrar (al subcontrato recién registrado,
 * a la orden recién abierta) todavía es lo que la persona espera. No lo es si
 * desde que salió: cambió la dirección («Atrás», un filtro, una búsqueda);
 * pidió ir a otro lado con un enlace, que Next deja en cola hasta que el envío
 * vuelve; hay otra ventana abierta, donde puede estar escribiendo; o cerró la
 * ventana del envío y después tocó algo. La ida se llevaba la segunda ventana
 * con lo escrito, o reemplazaba el menú pedido (W1 de la crítica de la
 * trigesimoctava pasada; lo mismo que la OT de la cotización, Y1 y H2).
 */
export function laIdaSigueEnPie(desde: Partida): boolean {
  if (pidioOtraPantalla(desde)) return false
  if (desde.ventana === null) return !hayVentanaAbierta()
  // Su ventana sigue abierta: la persona espera ahí.
  if (vecesQueSeCerro() === desde.ventana) return true
  return !hayVentanaAbierta() && tocoEn <= (cuandoSeCerro(desde.ventana) ?? Number.POSITIVE_INFINITY)
}

/**
 * El formulario que puso la línea de arriba: esta vez que está montado
 * (`instancia`) y qué campos envía (`campos`), que no cambian al volver a
 * montarse. Solo su envío siguiente quita el rechazo: el del mismo formulario,
 * aunque la persona haya cambiado de pestaña de la lista que lo pinta encima, o
 * el del mismo vuelto a montar en su dirección. Por el texto («lo que
 * enviaste»), dos formularios sin nombre de una pantalla se quitaban el motivo
 * uno al otro (R8 de realización); por la dirección, el comprobante corregido
 * después de cambiar de pestaña entraba y arriba seguía «no se guardó» (W1 de la
 * crítica, cuadragésima tercera pasada).
 */
export type DeFormulario = { instancia: string; campos: string }

/** Los campos de un envío, para reconocer el mismo formulario vuelto a montar (`DeFormulario`). */
export const camposDe = (datos: FormData) => [...new Set(datos.keys())].sort().join(',')

const esDelFormulario = (ida: IdaQueNoSalio, de: DeFormulario) =>
  ida.de !== undefined &&
  (ida.de.instancia === de.instancia || (ida.de.campos === de.campos && (ida.desde ?? ida.url) === window.location.pathname + window.location.search))

// Los formularios montados (`useFormularioMontado`): el rechazo del que sigue
// en la pantalla lo dice él, junto a su botón, y arriba se repetía.
const montados = new Set<string>()

/** Si el formulario que puso la línea sigue en la pantalla. */
export const sigueMontado = (de: DeFormulario | undefined) => Boolean(de && montados.has(de.instancia))

/**
 * Esta vez que el formulario está montado, para `DeFormulario`. Mientras siga
 * montado, lo suyo se dice en él y no arriba: la pestaña de la lista cambia la
 * dirección y deja el formulario donde estaba (W1 de la crítica, cuadragésima
 * tercera pasada).
 */
export function useFormularioMontado() {
  const instancia = useId()
  useEffect(() => {
    montados.add(instancia)
    return () => void montados.delete(instancia)
  }, [instancia])
  return instancia
}

/**
 * Lo que entró y adónde lleva, cuando su ida no salió (`navegarSiEsDeLaPestana`).
 * `dichaEn`: la dirección del formulario de página entera que ya lo dice junto
 * a su botón (`YaQuedo`); mientras la persona siga ahí, arriba no se repite.
 * `porOmision`: lo que la pantalla toma cuando su dirección no lo dice
 * (/personal sin «estado» es Activos), para saber que la persona llegó.
 * `rechazo`: lo que no entró, y su enlace vuelve al formulario
 * (`decirElRechazoSiSeFue`). `de`: el formulario que lo dijo; solo su envío
 * siguiente lo quita. `desde`: su dirección, cuando el enlace lleva a otra (lo
 * que ya había quedado lleva al reporte, no al formulario). `tono`: lo que quedó a medias (`aviso`) o lo que ya
 * había quedado la primera vez (`info`) no se pinta como el rechazo ni como lo
 * que entró.
 */
export type IdaQueNoSalio = {
  dice: string
  enlace: string
  url: string
  dichaEn?: string
  porOmision?: Record<string, string>
  rechazo?: boolean
  de?: DeFormulario
  desde?: string
  tono?: 'aviso' | 'info'
}
let idaQueNoSalio: IdaQueNoSalio | null = null
const alCambiarLaIda = new Set<() => void>()

export function ponerIdaQueNoSalio(ida: IdaQueNoSalio | null) {
  idaQueNoSalio = ida
  for (const avisar of alCambiarLaIda) avisar()
}

/**
 * Qué no se guardó, dicho arriba (`decirElRechazoSiSeFue`): `que`, «la orden»;
 * `enlace`, el que vuelve a su formulario. `yaEntro`: adónde se ve lo que ya
 * había quedado la primera vez (`decirQueYaHabiaEntradoSiSeFue`).
 */
export type SiSeVa = { que: string; enlace: string; yaEntro?: () => { url: string; enlace: string } }

/**
 * Lo de un formulario que no es de página entera ni va en una ventana (el tipo
 * de cambio, el gasto de la OT, la factura): su rechazo, con la persona ya en
 * otra pantalla, se perdía igual que el de la orden (Z1 de la crítica de la
 * cuadragésima segunda pasada).
 */
export const SI_SE_VA_DE_LA_PANTALLA: SiSeVa = { que: 'lo que enviaste', enlace: 'Volver adonde lo enviaste' }

const conMayuscula = (texto: string) => `${texto.charAt(0).toUpperCase()}${texto.slice(1)}`

/**
 * El rechazo de un formulario que vuelve cuando la persona ya pidió otra
 * pantalla: Next deja esa ida en cola hasta que el envío vuelve, y el rechazo se
 * pintaba en el formulario unos milisegundos antes de irse con él. En la
 * pantalla pedida nada decía que no había entrado, y lo escrito se perdía (Y1 de
 * la crítica de la cuadragésima primera pasada). Lo dice arriba, con el camino
 * de vuelta al formulario. Si la persona sigue ahí, ya lo dice el formulario y
 * esto no hace nada.
 *
 * Lo que pudo entrar no se dice «no se guardó»: sin respuesta, o con el servidor
 * caído a medio envío, la base pudo haberlo registrado, y un 502 con la persona
 * fuera decía lo contrario de lo que pasó y su enlace llevaba a registrarlo dos
 * veces (H1 de funcionalidad, cuadragésima segunda pasada). Lo que quedó a
 * medias tampoco: el envío dice qué decir arriba (`arriba`, el comprobante que
 * quedó en borrador, el plano que llegó a un área y a otra no) y la línea lo
 * dice tal cual, en el tono del aviso (R7 de realización y N2 de funcionalidad,
 * cuadragésima tercera pasada).
 *
 * `de`: el formulario que lo envió. Si la dirección ya cambió y el formulario
 * sigue en la pantalla, lo dice él y la línea calla (`IdaQueNoSalio`). No se
 * mira aquí: con la pantalla nueva ya en la dirección y la vieja todavía por
 * desmontar, el formulario que se iba contaba como presente y el rechazo no se
 * decía en ningún lado.
 */
export function decirElRechazoSiSeFue(desde: Partida, motivo: string, { que, enlace }: SiSeVa, { de, arriba }: { de?: DeFormulario; arriba?: string } = {}) {
  if (!pidioOtraPantalla(desde)) return
  if (arriba) return ponerIdaQueNoSalio({ dice: arriba, enlace, url: desde.direccion, rechazo: true, de, tono: 'aviso' })
  // «No se guardó: en otra pestaña…» ya lo dice la frase de delante.
  const porque = conMayuscula(motivo.replace(/^No se guardó: /, ''))
  const dice =
    pudoHaberEntrado(motivo) || motivo === FALLO_DEL_SERVIDOR ? `No se sabe si ${que} se guardó. ${porque}` : `${conMayuscula(que)} no se guardó. ${porque}`
  ponerIdaQueNoSalio({ dice, enlace, url: desde.direccion, rechazo: true, de })
}

/**
 * Lo enviado ya había entrado la primera vez y lo de esta vez no se guardó,
 * con la persona ya en otra pantalla: el formulario lo decía y se iba con él, y
 * la corrección se perdía sin que nada lo dijera (H3 de funcionalidad,
 * cuadragésima segunda pasada). `ida`: adónde se ve lo que quedó; sin ella,
 * la pantalla del formulario, que ya lo muestra. En el tono de la información,
 * como el formulario y la ventana lo dicen: en el verde de lo que entró se leía
 * como un éxito (H2 de diseño, cuadragésima tercera pasada).
 */
export function decirQueYaHabiaEntradoSiSeFue(desde: Partida, { que, enlace }: SiSeVa, ida?: { url: string; enlace: string }, de?: DeFormulario) {
  if (!pidioOtraPantalla(desde)) return
  ponerIdaQueNoSalio({
    dice: `${conMayuscula(que)} ya había quedado la primera vez que lo enviaste; lo que cambiaste después no se guardó.`,
    enlace: ida?.enlace ?? enlace,
    url: ida?.url ?? desde.direccion,
    de,
    desde: desde.direccion,
    tono: 'info',
  })
}

/** La ida que no salió, para decirla con su enlace (`IdaQueNoSalio` del encabezado). */
export function useIdaQueNoSalio() {
  return useSyncExternalStore(
    (avisar) => {
      alCambiarLaIda.add(avisar)
      return () => void alCambiarLaIda.delete(avisar)
    },
    () => idaQueNoSalio,
    () => null,
  )
}

// Un envío que entró y lleva a otra pantalla, después de un despliegue: Next la
// carga entera, y «Volver a cargar» no recarga encima la de antes. Se guarda
// adónde: si la ida no llega, el toque siguiente va allí y no a la de antes,
// que no sabe que lo enviado ya entró (F2 de la trigesimotercera pasada).
let seVaDeLaPantalla = false
let destinoDeLaIda: string | null = null
// Desde cuándo «Volver a cargar» espera esa ida. Aquí y no en el aviso: si el
// aviso se vuelve a montar mientras Next la carga, no pierde su espera de 15 s.
let idaDesde: number | null = null

/** Desde cuándo «Volver a cargar» espera la ida a otra pantalla, o `null`. */
export const desdeQueSeVa = () => idaDesde
// Adónde redirigió la última acción que redirige (`x-action-redirect`), que
// `useAccion` no ve: Next navega solo.
let ultimaRedireccion: string | null = null

/**
 * Lo enviado entró y la pantalla se va a `destino` (o a donde la acción
 * redirigió). Solo cuenta en la pestaña de otro despliegue: en las demás, Next
 * cambia de pantalla sin recargar y el aviso de arriba no está.
 */
export function anotarQueSeVa(destino?: string) {
  if (!laPestanaEsDeOtroDespliegue()) return
  seVaDeLaPantalla = true
  destinoDeLaIda = destino ?? ultimaRedireccion ?? destinoDeLaIda
  ultimaRedireccion = null
}

/**
 * Por qué «Volver a cargar» no recargó:
 *
 * · `se-va`: lo enviado entró y lleva a otra pantalla, y Next ya la está
 *   cargando entera. Recargar encima la cortaba a los 4 s y dejaba la de antes,
 *   vacía, con el reporte ya dentro (D13 e Importante 2 de la trigesimosegunda).
 * · `no-entro`: algo de lo que esperó volvió rechazado, sin respuesta o con un
 *   error. Su aviso está junto a su botón, y recargar se lo llevaba con lo
 *   escrito: «Pon al menos a una persona…» se veía 90 ms.
 */
export type SinRecargar = 'se-va' | 'no-entro'

/**
 * Recarga la pantalla después de lo de `alVolverACargar`, cuando lo que está en
 * camino ya volvió y entró. Si pasan 10 s, `alTardar`: la persona puede seguir
 * esperando o volver a pedirlo con `igual`, que ya no espera lo que estaba en
 * camino (ni lo que no entró): solo lo que se envió después. Antes recargaba al
 * tope con el envío en camino y la pantalla volvía vacía con el reporte dentro.
 */
export async function volverACargar({
  igual = false,
  alTardar,
}: { igual?: boolean; alTardar?: () => void } = {}): Promise<{ sinRecargar: SinRecargar; motivo: string | null } | null> {
  const { noEntro, motivo } = await envios.esperar({ igual, alTardar })
  // Si la ida no llega, el toque siguiente va a su destino (`irAlDestino`).
  if (seVaDeLaPantalla) {
    seVaDeLaPantalla = false
    idaDesde = Date.now()
    envios.ofrecer()
    return { sinRecargar: 'se-va', motivo: null }
  }
  if (noEntro) {
    envios.ofrecer()
    return { sinRecargar: 'no-entro', motivo }
  }
  const quitar = Promise.allSettled([...antesDeRecargar].map(async (q) => q()))
  await Promise.race([quitar, new Promise((listo) => setTimeout(listo, 4000))])
  irAlDestino()
  return null
}

// A la pantalla de la ida, si la hubo; si es esta misma (la tarjeta de la
// cotización, `#id`), se recarga con su marca: un `assign` que solo cambia lo de
// después de `#` no recarga.
function irAlDestino() {
  const aqui = window.location
  const ida = destinoDeLaIda ? new URL(destinoDeLaIda, aqui.href) : null
  if (ida && (ida.origin !== aqui.origin || ida.pathname !== aqui.pathname || ida.search !== aqui.search)) return aqui.assign(ida.href)
  if (ida?.hash && ida.hash !== aqui.hash) aqui.hash = ida.hash
  aqui.reload()
}

/**
 * El motivo de un `catch` que tiene el suyo («revisa la conexión y elígelo otra
 * vez»), salvo en una pestaña de antes del último despliegue: ahí reintentar no
 * sirve, y se dice que hay que recargar (vigesimoctava pasada).
 */
export const motivoDelFallo = (e: unknown, motivo: string) => (esDeLaVersionAnterior(e) ? SE_ACTUALIZO_EL_SISTEMA : motivo)

/** El servidor cayó a medio envío: pudo entrar, y se pide mirar antes de repetirlo. */
export const FALLO_DEL_SERVIDOR =
  'El servidor no pudo completar el envío. Mira si quedó guardado; si se repite, vuelve a cargar la pantalla o avisa al administrador.'

/**
 * Qué decir cuando la llamada a una acción de servidor lanza en vez de
 * devolver su resultado. Sin esto la excepción llegaba al límite de error: la
 * pantalla entera caía en «Esta pantalla no se pudo abrir» y se perdía lo
 * escrito (producción, 2026-10-21). La redirección de una acción también llega
 * como excepción, y esa sigue su camino. No todo es la señal: una pestaña de
 * antes del último despliegue o un fallo del servidor no se arreglan
 * reintentando.
 */
export function explicarFallo(e: unknown): string {
  unstable_rethrow(e)
  if (e instanceof OtraCuentaEnLaPestana) return e.message
  console.error(e)
  if (esDeLaVersionAnterior(e)) return SE_ACTUALIZO_EL_SISTEMA
  if (e instanceof TypeError || (typeof navigator !== 'undefined' && !navigator.onLine)) return SIN_RESPUESTA
  return FALLO_DEL_SERVIDOR
}

type Opciones = {
  /** Repintar la pantalla con lo recién guardado. No hace falta si `alTerminar` navega a otra. */
  refrescar?: boolean
  /**
   * Tras «… ya quedó … la primera vez que lo enviaste»: ese id ya terminó y el
   * envío siguiente lleva otro. Corre con la ventana ya cerrada, o en el acto si
   * no la había. Sin esto un id que vive fuera de la ventana se quedaba pegado:
   * cada documento siguiente de la compra decía «ya quedó» hasta recargar. Si la
   * respuesta llega tarde, puede haber otra ventana abierta: que ponga un id
   * nuevo, no que lo borre, o esa ventana se queda sin id para enviar.
   */
  alYaEntrar?: () => void
  /**
   * Si su rechazo vuelve cuando la persona ya pidió otra pantalla, arriba se
   * dice qué no se guardó (`que`, «la orden») y `enlace` vuelve al formulario
   * (`decirElRechazoSiSeFue`). Sin decirlo, «lo que enviaste»
   * (`SI_SE_VA_DE_LA_PANTALLA`); `null`, lo que sigue a la vista aunque la
   * persona cambie de pantalla (los avisos de la campana).
   */
  siSeVa?: SiSeVa | null
}

/**
 * Llamar a una acción de servidor con datos ya armados: una llamada por toque,
 * `enviando` pintado al instante y el resultado a la vista.
 *
 * Es la mitad de `useEnvio` que no necesita un formulario: el visto que se
 * marca con un botón, el «quitar» que confirma una ventana. Antes cada uno de
 * esos sitios llevaba su `useActionState` envuelto en `startTransition`, o su
 * par `useState(enviando)` + `router.refresh()` a mano, con las mismas dos
 * fallas que `useEnvio` explica abajo.
 */
export function useAccion<T = never>(
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>,
  alTerminar?: (resultado: Exito<T>, desde: Partida) => void,
  opciones: Opciones = {},
) {
  const { refrescar = true, alYaEntrar, siSeVa = SI_SE_VA_DE_LA_PANTALLA } = opciones
  const router = useRouter()
  const instancia = useFormularioMontado()
  const [enviando, iniciar] = useTransition()
  const enCurso = useRef(false)
  const [resultado, setResultado] = useState<ResultadoAccion<T> | null>(null)

  /**
   * Lo que sigue a un envío que no salió bien. El aviso que se leyó en su ventana
   * se va con ella: si el envío vive fuera (el pago de la tarjeta), volvía a
   * abrirse con el aviso viejo y, si era un «ya quedó», sin el botón que envía,
   * hasta recargar. El que llegó con la ventana ya cerrada nadie lo leyó: se
   * queda a la vista donde la pantalla lo pinte, salvo que sea un «ya quedó» o que
   * haya otra ventana abierta, que no es la suya. Soltarlo siempre callaba el
   * rechazo de «Sacar de la lista» y de quitar un repuesto (decimoquinta pasada).
   * Cuando el envío pudo entrar —ya entró, o no llegó la respuesta—, la pantalla
   * de detrás se pone al día al cerrar, para que no ofrezca otra vez lo que ya
   * entró: con «No llegó la respuesta», cancelar y volver a abrir, la tarjeta
   * seguía con el saldo de antes y se pagaba dos veces (decimocuarta pasada). Con
   * la ventana abierta espera a que se cierre: antes la desmontaba con el aviso a
   * medio leer (`ventanas-abiertas.ts`). Sin ventana, el aviso se queda a la vista.
   *
   * Para «Volver a cargar», el del aviso de arriba tras un despliegue: lo que ya
   * había quedado la primera vez entró, y recarga. El rechazo que volvió con su
   * ventana ya cerrada no se ve en ningún lado —la ventana lo pinta adentro, y
   * al reabrirla se limpia o se suelta—: el aviso de arriba dice su motivo en
   * vez de mandar a leer un aviso que no existe (funcionalidad H1 de la
   * trigesimoquinta pasada). Salvo que se diga junto al botón (`conFotos`).
   */
  function despuesDelRechazo(
    salida: ResultadoAccion<T>,
    desde: Partida,
    lanzo: boolean,
    { entro, noEntro, de }: { entro: () => void; noEntro: (motivo: string) => void; de: DeFormulario },
  ) {
    if (salida.ok) return
    const { ventana } = desde
    const desdeVentana = ventana !== null
    const yaEntro = yaEntroLaPrimeraVez(salida.error)
    if (yaEntro) entro()
    else if (desdeVentana && ventana !== vecesQueSeCerro() && !seDiceJuntoAlBoton.has(accion)) noEntro(salida.error)
    // La subida con su archivo no lanza: devuelve «No llegó la respuesta…» (`anotarSinDejarloSuelto`).
    const pudoEntrar = lanzo || pudoHaberEntrado(salida.error)
    const ponerAlDia = refrescar && (yaEntro || (pudoEntrar && desdeVentana))
    if (!desdeVentana) {
      if (yaEntro) alYaEntrar?.()
      if (siSeVa) {
        if (yaEntro) decirQueYaHabiaEntradoSiSeFue(desde, siSeVa, siSeVa.yaEntro?.(), de)
        else decirElRechazoSiSeFue(desde, salida.error, siSeVa, { de, arriba: salida.arriba })
      }
      if (ponerAlDia) iniciar(() => refrescarSiEsDeLaPestana(router))
      return
    }
    const soltar = () => {
      setResultado((r) => (r === salida ? null : r))
      if (yaEntro) alYaEntrar?.()
    }
    const alCerrar = () => {
      soltar()
      if (ponerAlDia) refrescarSiEsDeLaPestana(router)
    }
    if (ventana === vecesQueSeCerro() && alCerrarLaVentana(alCerrar)) return
    // La ventana del envío ya se cerró: la que esté abierta ahora es otra. El
    // aviso se suelta fuera de la transición: dentro esperaba al refresco, y
    // con la señal lenta la ventana que se volvía a abrir salía trabada con el
    // «ya quedó» del envío anterior. Sin otra ventana, el rechazo se queda.
    if (yaEntro || hayVentanaAbierta()) soltar()
    if (ponerAlDia) iniciar(() => refrescarSiEsDeLaPestana(router))
  }

  function ejecutar(datos: FormData) {
    if (enCurso.current) return
    // La sesión es de la cuenta que entró en otra pestaña: lo que saliera de
    // aquí entraría a su nombre. Se mira la cookie en el momento del toque, no
    // solo el aviso de la otra pestaña, que llega cuando esa termina de pintarse
    // (vigesimosegunda pasada). No queda ningún rojo: lo dice la traba de la
    // pantalla, que se abre con esto, y un «No se envió» se quedaba en la fila
    // después de que la cuenta volviera.
    if (laPestanaEsDeOtraCuenta()) return
    enCurso.current = true
    setResultado(null)
    const desde = partida()
    const de: DeFormulario = { instancia, campos: camposDe(datos) }

    iniciar(() => mientrasSeEnvia(async (entro, noEntro) => {
      const desenlace = { entro, noEntro, de }
      // Mientras Next navega por la redirección de la acción, el botón sigue
      // bloqueado: soltarlo dejaba pasar un segundo envío en ese instante.
      let soltar = true
      try {
        let salida: ResultadoAccion<T>
        try {
          salida = await accion(null, datos)
        } catch (e) {
          // Lo frenó `salio()`, o cortó la cadena antes de anotar: no quedó nada.
          // Se dice en la ventana, que sigue abierta y llena: con el botón apagado
          // mientras enviaba, el cursor había caído a la página, y al volver la
          // cuenta nada decía que no se guardó (vigesimosexta pasada, el pago de
          // Tesorería). El aviso nace con la traba puesta: al volver, el cursor va
          // a él. El primer toque con la traba ya puesta no llega aquí: se frena
          // arriba, sin aviso.
          if (e instanceof OtraCuentaEnLaPestana) {
            const corte: ResultadoAccion<T> = { ok: false, error: NO_SE_GUARDO_OTRA_CUENTA }
            setResultado(corte)
            despuesDelRechazo(corte, desde, false, desenlace)
            return
          }
          let mensaje: string
          try {
            mensaje = explicarFallo(e)
          } catch (deNext) {
            soltar = false
            entro()
            anotarQueSeVa()
            throw deNext
          }
          const fallo: ResultadoAccion<T> = { ok: false, error: mensaje }
          setResultado(fallo)
          despuesDelRechazo(fallo, desde, true, desenlace)
          return
        }
        // Una acción que redirige (abrir la orden desde la cotización) no
        // devuelve nada: Next ya está navegando a la pantalla nueva.
        if (!salida) {
          entro()
          anotarQueSeVa()
          return
        }
        setResultado(salida)
        if (!salida.ok) {
          despuesDelRechazo(salida, desde, false, desenlace)
          return
        }

        entro()
        alTerminar?.(salida, desde)
        // El ok puede llegar con la traba ya puesta: salió antes del cambio de cuenta.
        if (refrescar) iniciar(() => refrescarSiEsDeLaPestana(router))
      } finally {
        if (soltar) enCurso.current = false
      }
    }, desde.ventana === null ? de : undefined))
  }

  return {
    ejecutar,
    enviando,
    resultado,
    error: resultado && !resultado.ok ? resultado.error : null,
    limpiar: () => setResultado(null),
  }
}

/**
 * Enviar un formulario a una acción de servidor: un envío por toque, el botón
 * desactivado desde el primer toque, y lo escrito a salvo si el servidor lo
 * rechaza.
 *
 * Existe porque el patrón anterior —`<form action={enviar}>` con un `useState`
 * para «enviando»— tenía dos defectos, medidos en el despliegue el 2026-09-10
 * con `herramientas/recorrido/doble-toque.mjs`:
 *
 * 1. **Cada toque de más se enviaba.** La función de un `<form action>` corre
 *    dentro de una transición, y React 19 no pinta lo que cambia adentro hasta
 *    que la acción termina: el `setEnviando(true)` no llegaba a la pantalla, el
 *    botón seguía activo y cada toque quedaba en cola. Un reporte de flota
 *    entró tres veces con un segundo de diferencia; antes habían entrado dos
 *    contactos iguales igual, y se culpó al tiempo entre el clic y el
 *    repintado. `isPending` de `useTransition` sí se pinta al instante, y la
 *    referencia corta el reingreso aunque React todavía no haya pintado nada.
 * 2. **Un rechazo borraba lo escrito.** React vacía un `<form action>` al
 *    terminar la acción, haya salido bien o mal: el supervisor que escribió un
 *    reporte largo lo perdía con el primer «Cuenta qué se le hizo hoy». Con
 *    `onSubmit` React no toca el formulario. Tampoco se vacía al salir bien, y
 *    no hace falta: la `Ventana` desmonta lo suyo al cerrarse, y un
 *    `form.reset()` a ciegas devolvería los campos controlados (el programa de
 *    taller) a un valor que el estado ya no tiene.
 *
 * Uso:
 *
 *   const { alEnviar, enviando, error } = useEnvio(accion, () => setAbierto(false))
 *   <form onSubmit={alEnviar}> … <Boton type="submit" cargando={enviando}>
 *
 * Lo que no está en un campo —las fotos ya subidas— se agrega al enviar:
 * `onSubmit={(e) => alEnviar(e, (datos) => datos.set('fotos', …))}`.
 */
export function useEnvio<T = never>(
  accion: (previo: unknown, datos: FormData) => Promise<ResultadoAccion<T>>,
  alTerminar?: (resultado: Exito<T>, desde: Partida) => void,
  opciones: Opciones = {},
) {
  const { ejecutar, ...resto } = useAccion(accion, alTerminar, opciones)

  function alEnviar(evento: FormEvent<HTMLFormElement>, preparar?: (datos: FormData) => void) {
    evento.preventDefault()
    const datos = new FormData(evento.currentTarget)
    preparar?.(datos)
    ejecutar(datos)
  }

  return { alEnviar, ...resto }
}

/**
 * El id de un envío que vive fuera de su ventana (el pago de la tarjeta, la OS,
 * el RQ). Se conserva hasta saber cómo terminó: tras «No llegó la respuesta»,
 * cancelar y volver a abrir lleva el mismo, y lo repetido dice que ya quedó en
 * vez de entrar dos veces (decimocuarta pasada).
 *
 * Al volver a abrir se pregunta a la base si aquel envío entró
 * (`consultarEnvio`). Si entró, lo que se escriba ahora es otro documento u otro
 * pago: con el mismo id, la OS, el RQ o el subcontrato siguiente decía «ya
 * quedó» y no se guardaba, aunque la lista ya mostrara el primero (decimosexta
 * pasada). Entonces la ventana dice cuál quedó (`anterior`) y lleva un id nuevo.
 * Mientras la base no contesta, o si no entró, sigue el mismo: lo peor es un «ya
 * quedó» que se cierra, nunca un documento doble. Antes se adivinaba por el
 * estado de la pantalla —el saldo había bajado—, y tras ponerse al día el mismo
 * pago entraba dos veces sin que nada lo dijera (decimosexta pasada). La nota
 * se queda hasta el envío siguiente, también al cerrar y volver a abrir: se
 * borraba al abrir, y si la respuesta había llegado con la ventana cerrada, la
 * ventana salía muda con un id nuevo y lo mismo enviado otra vez entraba dos
 * veces (decimoséptima pasada).
 *
 * Sin `clave` no se pregunta: es el id de algo que sale con el documento (su
 * factura, su contrato), y se renueva con él (`alEntrar`). Con `donde`, se
 * guarda en la pestaña como el del documento: tras una recarga, su archivo
 * vuelve a la misma ruta y no queda uno suelto.
 *
 * El id pendiente se guarda también en la pestaña (`sessionStorage`), por
 * `clave` y por `donde` —la fila de la ventana: la OC que se paga, el recibo—,
 * porque al cerrar tras «No llegó la respuesta» la pantalla se pone al día, y si
 * ese refresco no llega (sin señal, el servidor que reinicia, un despliegue),
 * Next recarga la página entera. La memoria se borraba, la ventana no
 * preguntaba y el mismo pago o el mismo RQ entraba dos veces (decimoctava
 * pasada). `donde` separa las filas: sin él, el pendiente de una OC lo tomaba la
 * ventana de otra.
 *
 * Y va por la cuenta con que se pintó la pantalla (`entroLaCuenta`), pero lo
 * juzga quien lo registró. Al abrir se pregunta por lo pendiente de ese lugar
 * con todas las cuentas que pasaron por la pestaña, y la base contesta con la
 * cuenta de la sesión (vigésima pasada):
 * - Lo que quedó registrado por la sesión se le dice, aunque se haya mandado
 *   desde una pantalla pintada con otra cuenta: antes la llave de esa cuenta no
 *   se leía y la OC entraba dos veces.
 * - Lo que otra cuenta registró con lo pendiente de otra llave no se le cuenta
 *   ni se toca: si la primera vuelve, lo suyo sigue pendiente (decimonovena
 *   pasada). Lo pendiente de la llave de esta pantalla sí se dice aunque lo haya
 *   registrado otra: salió de aquí. Va con su número y con el puesto de quien
 *   tenía la sesión (vigesimoprimera pasada).
 * - Si la sesión no es la de la pantalla, en otra pestaña entró otra cuenta: la
 *   pestaña se traba (`laPestanaEsDeOtraCuenta`) y lo pendiente no se toca. La
 *   respuesta de la pregunta dice con qué cuenta está la sesión, y vale solo si
 *   la cookie de la sesión no se puede leer: la cookie es más nueva.
 *
 * Uso: `abrir()` al abrir la ventana, `salio()` al enviar (dentro de la acción),
 * `otro()` con el ok y con `alYaEntrar`; `anterior`, dentro de la ventana
 * (`EnvioAnterior`).
 */
export function useIdDelEnvio(clave?: ClaveDelEnvio, alEntrar?: (cuentas: Cuentas) => void, donde = '') {
  const [id, setId] = useState<string | null>(null)
  const [anterior, setAnterior] = useState<string | null>(null)
  // El id que salió sin que se sepa cómo terminó, y de qué cuenta.
  const pendiente = useRef<{ cuenta: string | null; id: string } | null>(null)
  // Cambia con cada apertura y cada envío: la respuesta de una consulta vieja no pisa lo que vino después.
  const turno = useRef(0)
  const lugar = clave ? `${clave}:${donde}` : donde
  function llave(cuenta = cuentaDeLaPestana) {
    if (!cuenta || !lugar) return null
    return `${PENDIENTE}${cuenta}:${lugar}`
  }
  function anotar(valor: string | null) {
    pendiente.current = valor ? { cuenta: cuentaDeLaPestana, id: valor } : null
    const enLaPestana = llave()
    if (enLaPestana) guardarEnLaPestana(enLaPestana, valor)
  }
  function nuevo() {
    turno.current++
    setAnterior(null)
    anotar(null)
    setId(crypto.randomUUID())
  }
  return {
    id,
    anterior,
    abrir() {
      // La ventana se abre ya trabada si la sesión cambió sin que nada avisara.
      laPestanaEsDeOtraCuenta()
      // Tras una recarga la memoria está vacía, y lo pendiente sigue en la pestaña.
      const cuenta = cuentaDeLaPestana
      const propia = llave(cuenta)
      const enMemoria = pendiente.current?.cuenta === cuenta ? pendiente.current.id : null
      const previo = enMemoria ?? (propia ? leerDeLaPestana(propia) : null)
      pendiente.current = previo ? { cuenta, id: previo } : null
      const este = ++turno.current
      setId(previo ?? crypto.randomUUID())
      if (!clave) return
      // Lo que quedó pendiente aquí con otras cuentas: lo mandado desde una
      // pantalla pintada con otra cuenta quedó en la llave de esa.
      const ajenos = lugar ? pendientesEnLaPestana(lugar).filter((p) => p.llave !== propia && p.id !== previo) : []
      const ids = [...(previo ? [previo] : []), ...ajenos.map((p) => p.id)].slice(0, MAXIMO_PENDIENTES)
      const pregunta = preguntaDeLaSesion()
      consultarEnvio(clave, ids).then(
        (respuesta) => {
          if (!respuesta || !cuenta) return
          const deOtra = respuesta.cuenta !== cuenta
          pregunta(respuesta.cuenta, respuesta.puesto, respuesta.nombre)
          // Lo pendiente lo resuelve la pantalla pintada con la cuenta que entró.
          if (deOtra || turno.current !== este) return
          const propios: LoQueEntro[] = []
          let deOtraCuenta: LoQueEntro | null = null
          const entraron: (string | null)[] = []
          const suyo = previo ? respuesta.entraron[previo] : undefined
          if (suyo) {
            // Entró, con esta cuenta o con la que había en la sesión al enviarlo.
            anotar(null)
            setId(crypto.randomUUID())
            if (suyo.autor) deOtraCuenta = suyo
            else propios.push(suyo)
            entraron.push(cuenta)
          }
          for (const p of ajenos) {
            const lo = respuesta.entraron[p.id]
            if (!lo || lo.autor) continue
            soltarDeLaPestana(p.llave, p.id)
            propios.push(lo)
            entraron.push(p.cuenta)
          }
          if (entraron.length === 0) return
          setAnterior(contarLoQueEntro(propios, deOtraCuenta))
          alEntrar?.(entraron)
        },
        // Sin respuesta tampoco se sabe: sigue el mismo id. Si la pregunta ya no
        // existe, la pestaña es vieja, y se dice en el acto: antes la persona
        // escribía la ventana entera y se enteraba al enviar (trigésima pasada).
        (e: unknown) => void esDeLaVersionAnterior(e, { sinAvisoPropio: true }),
      )
    },
    salio() {
      if (laPestanaEsDeOtraCuenta()) throw new OtraCuentaEnLaPestana()
      turno.current++
      setAnterior(null)
      if (id) anotar(id)
    },
    /**
     * Un id nuevo. Con `cuentas` —las de los envíos que, al abrir, la base dijo
     * que entraron (`alEntrar`)—, solo si entre ellas está la de la pantalla; de
     * las otras se suelta lo pendiente de este lugar: el comprobante de la OC
     * que entró desde la pantalla de otra cuenta, que esa cuenta volvería a usar.
     */
    otro(cuentas?: Cuentas) {
      if (!cuentas) return nuevo()
      for (const otra of cuentas) {
        const suya = otra && otra !== cuentaDeLaPestana ? llave(otra) : null
        if (suya) guardarEnLaPestana(suya, null)
      }
      if (cuentas.includes(cuentaDeLaPestana)) nuevo()
    },
  }
}

/** Las cuentas cuyos envíos pendientes entraron: `null`, la pantalla sin cuenta todavía. */
type Cuentas = readonly (string | null)[]

const PENDIENTE = 'metal-work:envio-pendiente:'
const ES_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// La pestaña puede no dejar guardar (navegación privada, almacenamiento lleno):
// entonces vale solo la memoria, como antes.
function leerDeLaPestana(llave: string): string | null {
  try {
    const valor = sessionStorage.getItem(llave)
    return valor && ES_UUID.test(valor) ? valor : null
  } catch {
    return null
  }
}

function guardarEnLaPestana(llave: string, valor: string | null) {
  try {
    if (valor) sessionStorage.setItem(llave, valor)
    else sessionStorage.removeItem(llave)
  } catch {}
}

/** Lo pendiente de ese lugar con cada cuenta que pasó por la pestaña: `<PENDIENTE><cuenta>:<lugar>`. */
function pendientesEnLaPestana(lugar: string): { llave: string; cuenta: string; id: string }[] {
  const hallados: { llave: string; cuenta: string; id: string }[] = []
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const llave = sessionStorage.key(i)
      if (!llave?.startsWith(PENDIENTE)) continue
      const cuenta = llave.slice(PENDIENTE.length, PENDIENTE.length + 36)
      if (!ES_UUID.test(cuenta) || llave.slice(PENDIENTE.length + 36) !== `:${lugar}`) continue
      const id = leerDeLaPestana(llave)
      if (id && !hallados.some((h) => h.id === id)) hallados.push({ llave, cuenta, id })
    }
  } catch {}
  return hallados
}

/** Suelta lo pendiente de esa llave si sigue siendo ese id. */
function soltarDeLaPestana(llave: string, id: string) {
  if (leerDeLaPestana(llave) === id) guardarEnLaPestana(llave, null)
}

let cuentaDeLaPestana: string | null = null

/**
 * La cuenta con la que se pintó la pantalla (`CuentaDeLaPestana`, en el layout).
 * Lo pendiente se guarda con ella: si en la pestaña entra otra persona, su
 * ventana no reusa ese id, y si vuelve la primera, lo suyo sigue pendiente. Se
 * toma del servidor y no del ingreso: se entra también por el enlace de
 * recuperación, y en otra pestaña. Solo la pone el layout: la respuesta de la
 * base con otra cuenta no la cambia, porque la pantalla sigue siendo la de antes.
 *
 * Pintarse con la sesión destraba la pestaña: la pantalla ya es de esa cuenta,
 * salvo que la cookie diga que mientras llegaba la página entró otra. Y se avisa
 * a las otras pestañas del navegador, que comparten la sesión
 * (`escucharLaSesion`).
 */
export function entroLaCuenta(usuario: string, puesto: string, nombre: string) {
  // Lo que esperaba a la cuenta de antes (`cuandoVuelvaLaCuenta`) no es de esta: se suelta.
  if (cuentaDeLaPestana !== null && cuentaDeLaPestana !== usuario) {
    alVolver.clear()
    navegaciones.clear()
  }
  cuentaDeLaPestana = usuario
  conocer(usuario, puesto, nombre)
  noticias++
  // De una vez: destrabar y volver a trabar corría lo que esperaba a la cuenta
  // con la sesión de la otra.
  if (!revisarLaSesion()) marcarOtraCuenta(null)
  escucharLaSesion()
  try {
    canal?.postMessage({ usuario, puesto, nombre })
  } catch {}
}

/** El puesto y el nombre de cada cuenta que se supo en esta pestaña: con ellos se nombran en la traba. */
const conocidas = new Map<string, { puesto: string; nombre: string }>()

function conocer(usuario: string, puesto: unknown, nombre: unknown) {
  if (typeof puesto !== 'string' || !puesto) return
  conocidas.set(usuario, { puesto, nombre: typeof nombre === 'string' ? nombre : '' })
}

const CANAL = 'metal-work:cuenta'
let canal: BroadcastChannel | null = null
let escuchando = false

/**
 * Cómo se entera la pestaña de que la sesión ya no es la suya, sin esperar a
 * que se envíe nada:
 * - La cookie de la sesión cambia en el momento en que otra pestaña entra: el
 *   navegador que lo cuenta (`cookieStore`) traba al instante, y en todos se
 *   vuelve a mirar al volver a la pestaña.
 * - La otra pestaña avisa cuando termina de pintarse (`BroadcastChannel`), con
 *   el puesto y el nombre de quien entró. El aviso no se cree solo si la cookie
 *   se puede leer: un aviso viejo —la página de una tercera pestaña que llegó
 *   tarde— destrababa una pestaña que ya tenía la sesión de otra
 *   (vigesimosegunda pasada).
 * Lo que no se pueda usar (un navegador sin `cookieStore`, sin
 * `BroadcastChannel`) se deja: queda lo demás, y se mira otra vez al enviar.
 */
function escucharLaSesion() {
  if (escuchando) return
  escuchando = true
  try {
    canal = new BroadcastChannel(CANAL)
    canal.onmessage = ({ data }: MessageEvent<{ usuario?: unknown; puesto?: unknown; nombre?: unknown }>) => {
      if (!cuentaDeLaPestana || typeof data?.usuario !== 'string') return
      conocer(data.usuario, data.puesto, data.nombre)
      if (revisarLaSesion()) return
      noticias++
      marcarOtraCuenta(data.usuario === cuentaDeLaPestana ? null : textoOtraCuenta(data.usuario))
    }
  } catch {}
  try {
    ;(globalThis as { cookieStore?: EventTarget }).cookieStore?.addEventListener('change', () => revisarLaSesion())
  } catch {}
  window.addEventListener('focus', () => revisarLaSesion())
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') revisarLaSesion()
  })
}

/**
 * Mira la cookie y traba o destraba según de quién sea la sesión. `false` si la
 * cookie no dice nada: entonces vale lo que digan el aviso y la pregunta.
 */
function revisarLaSesion(): boolean {
  if (!cuentaDeLaPestana || typeof document === 'undefined') return false
  const sesion = cuentaEnLaCookie()
  if (!sesion) return false
  noticias++
  marcarOtraCuenta(sesion === cuentaDeLaPestana ? null : textoOtraCuenta(sesion))
  return true
}

/**
 * Si esta pestaña es de otra cuenta que la de la sesión. Se mira la cookie en
 * el acto: lo llama todo lo que envía (`useAccion`, `salio()`, los formularios
 * que suben por su cuenta) antes de salir. El aviso de la otra pestaña llega
 * cuando esa termina de pintarse —3,5 s en el banco—, y lo enviado en ese rato,
 * o desde una ventana abierta antes del cambio sin aviso, entraba a nombre de la
 * otra cuenta (vigesimosegunda pasada).
 */
export function laPestanaEsDeOtraCuenta() {
  revisarLaSesion()
  return otraCuenta !== null
}

/**
 * La pregunta al abrir una ventana (`consultarEnvio`) también dice con qué
 * cuenta está la sesión. Vale solo si la cookie no se puede leer, y solo la de
 * la última pregunta y si mientras tanto no llegó otra noticia: con dos
 * aperturas seguidas, la respuesta de la primera gastaba la noticia y la de la
 * segunda, que decía «otra cuenta», se ignoraba (vigesimosegunda pasada).
 */
function preguntaDeLaSesion() {
  const esta = ++preguntas
  const visto = noticias
  return (cuenta: string, puesto: string, nombre: string) => {
    conocer(cuenta, puesto, nombre)
    if (revisarLaSesion() || esta !== preguntas || visto !== noticias || !cuentaDeLaPestana) return
    marcarOtraCuenta(cuenta === cuentaDeLaPestana ? null : textoOtraCuenta(cuenta))
  }
}

/**
 * Con qué cuenta está la sesión según su cookie, la que el navegador manda con
 * cada envío. La de Supabase (`sb-<proyecto>-auth-token`, en trozos `.0`, `.1`
 * si es larga) lleva la sesión en JSON, en base64 desde `@supabase/ssr` 0.4, y
 * se puede leer desde la página (`httpOnly: false`, como la deja `@supabase/ssr`
 * para su cliente del navegador). `undefined` si no se puede saber: sin cookie,
 * con varias o con un formato que no se reconoce. Entonces la cookie no traba
 * nada: leerla mal trabaría a todos.
 */
function cuentaEnLaCookie(): string | undefined {
  try {
    const id = idDeLaSesion(sesionEnLaCookie())
    return id && ES_UUID.test(id) ? id : undefined
  } catch {
    return undefined
  }
}

/** La sesión que guarda la cookie, en JSON, o `undefined` si no se reconoce (`cuentaEnLaCookie`). */
function sesionEnLaCookie(): unknown {
  try {
    const trozos = new Map<string, Map<number, string>>()
    for (const par of document.cookie.split(';')) {
      const igual = par.indexOf('=')
      if (igual < 0) continue
      const coincide = COOKIE_DE_LA_SESION.exec(par.slice(0, igual).trim())
      if (!coincide) continue
      const deEsa = trozos.get(coincide[1]) ?? new Map<number, string>()
      deEsa.set(coincide[2] === undefined ? -1 : Number(coincide[2]), par.slice(igual + 1).trim())
      trozos.set(coincide[1], deEsa)
    }
    if (trozos.size !== 1) return undefined
    const [partes] = trozos.values()
    let valor = partes.get(-1)
    if (valor === undefined) {
      const orden = [...partes.keys()].sort((a, b) => a - b)
      if (orden.some((n, i) => n !== i)) return undefined
      valor = orden.map((n) => partes.get(n)).join('')
    }
    let texto = decodeURIComponent(valor)
    if (texto.startsWith(BASE64)) texto = desdeBase64Url(texto.slice(BASE64.length))
    return JSON.parse(texto) as unknown
  } catch {
    return undefined
  }
}

const COOKIE_DE_LA_SESION = /^(sb-.+-auth-token)(?:\.(0|[1-9]\d*))?$/
const BASE64 = 'base64-'

function idDeLaSesion(sesion: unknown): string | undefined {
  if (!sesion || typeof sesion !== 'object') return undefined
  const { user, access_token } = sesion as { user?: { id?: unknown }; access_token?: unknown }
  if (typeof user?.id === 'string') return user.id
  if (typeof access_token !== 'string') return undefined
  const carga = access_token.split('.')[1]
  if (!carga) return undefined
  const { sub } = JSON.parse(desdeBase64Url(carga)) as { sub?: unknown }
  return typeof sub === 'string' ? sub : undefined
}

function desdeBase64Url(texto: string) {
  const base64 = texto.replace(/-/g, '+').replace(/_/g, '/')
  const binario = atob(base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '='))
  return new TextDecoder().decode(Uint8Array.from(binario, (c) => c.charCodeAt(0)))
}

/**
 * La sesión se refresca fuera de las acciones (X8 de la crítica de la
 * trigesimoprimera pasada). El proxy la refresca en cada pedido al que le
 * quedan menos de 90 s, y si el pedido es una acción, Next cuenta esas cookies
 * como cambiadas por ella y la responde revalidada: en una pestaña de otro
 * despliegue eso recarga el documento entero aunque la acción no revalide (la
 * pregunta de cada minuto, lo leído de la campana, el conteo del kardex). Una
 * vez por hora, sin que nadie enviara nada, se perdía lo escrito y la foto
 * quedaba suelta.
 *
 * Así que toda acción espera antes de salir a `sesionAlDia`: si a la sesión le
 * quedan menos de diez minutos según su cookie, o si hace cinco que no se
 * pregunta (el reloj del teléfono puede ir atrasado), se pide a `/auth/sesion`,
 * un GET, que la refresque; ahí las cookies nuevas no repintan nada. Se mira en
 * el `fetch` con que Next manda la acción, para que ninguna se quede fuera: la
 * que se llama desde un `onClick`, las de un bucle, las que la pantalla pide
 * sola. Sin señal, o pasados 4 s, la acción sale igual y dice lo suyo.
 */
const MARGEN_DE_LA_SESION_MS = 10 * 60_000
const CADA_CUANTO_SE_PREGUNTA_MS = 5 * 60_000
let preguntadaLaSesion = 0
let sesionEnCamino: Promise<void> | null = null
let vigilandoLasAcciones = false

export function refrescarLaSesionAntesDeCadaAccion() {
  if (vigilandoLasAcciones || typeof window === 'undefined') return
  vigilandoLasAcciones = true
  const pedir = window.fetch.bind(window)
  window.fetch = (async (entrada: RequestInfo | URL, opciones?: RequestInit) => {
    if (!esUnaAccion(opciones)) return pedir(entrada, opciones)
    // Quien envía ya miró la cuenta, pero la espera puede durar 4 s: si en ese
    // rato entró otra en otra pestaña, la acción saldría a su nombre. Solo si
    // antes era la de la pantalla: la pregunta de la traba sale igual.
    const eraLaSuya = !laPestanaEsDeOtraCuenta()
    if ((await sesionAlDia(pedir)) && eraLaSuya && laPestanaEsDeOtraCuenta()) throw new OtraCuentaEnLaPestana()
    const respuesta = await pedir(entrada, opciones)
    const ida = respuesta.headers.get('x-action-redirect')?.split(';')[0]
    if (ida) ultimaRedireccion = ida
    return respuesta
  }) as typeof fetch
}

function esUnaAccion(opciones?: RequestInit) {
  const cabeceras = opciones?.headers
  if (opciones?.method !== 'POST' || !cabeceras) return false
  if (cabeceras instanceof Headers) return cabeceras.has('next-action')
  const nombres = Array.isArray(cabeceras) ? cabeceras.map(([nombre]) => nombre) : Object.keys(cabeceras)
  return nombres.some((nombre) => nombre.toLowerCase() === 'next-action')
}

/** `true` si esperó a `/auth/sesion`: la cookie pudo cambiar en ese rato. */
function sesionAlDia(pedir: typeof fetch): Promise<boolean> {
  if (sesionEnCamino) return sesionEnCamino.then(() => true)
  const ahora = Date.now()
  const desde = ahora - preguntadaLaSesion
  const vence = venceLaSesion()
  // Recién preguntada, no: con el reloj adelantado, cada acción preguntaría.
  const porVencer = vence !== undefined && vence - ahora < MARGEN_DE_LA_SESION_MS && desde > 30_000
  if (!porVencer && desde < CADA_CUANTO_SE_PREGUNTA_MS) return Promise.resolve(false)
  sesionEnCamino = (async () => {
    const corte = new AbortController()
    const tope = setTimeout(() => corte.abort(), 4000)
    try {
      if ((await pedir('/auth/sesion', { cache: 'no-store', signal: corte.signal })).ok) preguntadaLaSesion = Date.now()
    } catch {
      // Sin señal la acción tampoco llega: que lo diga ella.
    } finally {
      clearTimeout(tope)
      sesionEnCamino = null
    }
  })()
  return sesionEnCamino.then(() => true)
}

/** Cuándo vence la sesión según su cookie, en ms, o `undefined` si no se sabe. */
function venceLaSesion(): number | undefined {
  const sesion = sesionEnLaCookie()
  if (!sesion || typeof sesion !== 'object') return undefined
  const { expires_at } = sesion as { expires_at?: unknown }
  return typeof expires_at === 'number' && Number.isFinite(expires_at) ? expires_at * 1000 : undefined
}

/**
 * Lo que dice la pantalla si en otra pestaña del mismo navegador entró otra
 * cuenta: la sesión ya es de ella, y esta pantalla, pintada con la anterior,
 * enviaría a su nombre. El egreso, la OC o el recibo entraban con la otra
 * persona sin que nada lo dijera, y con lo que esa no puede ver salía «No
 * tienes permiso» (vigésima y vigesimoprimera pasada). Mientras dure, la
 * pantalla entera queda debajo de una traba que solo ofrece recargar
 * (`CuentaDeLaPestana`) y nada se envía (`laPestanaEsDeOtraCuenta`).
 */
let otraCuenta: string | null = null
// Cuenta las noticias de la sesión (la cookie, el aviso, la pantalla pintada): la respuesta de una pregunta que salió antes no pisa lo que llegó después.
let noticias = 0
// Cuenta las preguntas al abrir: vale la respuesta de la última.
let preguntas = 0
const vigias = new Set<() => void>()
// Lo que se dejó para cuando la pantalla vuelva a ser de la sesión (`cuandoVuelvaLaCuenta`).
const alVolver = new Set<() => void>()
// De eso, lo que lleva a otra pantalla (`navegarSiEsDeLaPestana`), con cómo saber si todavía va.
const navegaciones = new Map<() => void, () => boolean>()
// La última vuelta de la cuenta llevó a otra pantalla: la traba no dice «puedes seguir donde estabas».
let alVolverSeFue = false

function marcarOtraCuenta(texto: string | null) {
  if (otraCuenta === texto) return
  const estabaTrabada = otraCuenta !== null
  otraCuenta = texto
  // Antes de avisar: la traba lo lee al quitarse.
  if (texto === null && estabaTrabada) alVolverSeFue = [...alVolver].some((hacer) => navegaciones.get(hacer)?.() ?? false)
  for (const avisar of vigias) avisar()
  if (texto !== null || !estabaTrabada) return
  const pendientes = [...alVolver]
  alVolver.clear()
  navegaciones.clear()
  for (const hacer of pendientes) hacer()
}

/**
 * Si al volver la cuenta la pantalla se fue a la que seguía a un envío (la
 * orden recién abierta, el trabajo recién reportado). La traba decía «puedes
 * seguir donde estabas» con la pantalla ya yéndose (vigesimoquinta pasada).
 */
export function alVolverLaCuentaSeFue() {
  return alVolverSeFue
}

/**
 * Deja `hacer` para cuando la pantalla vuelva a ser de la sesión: lo que solo la
 * cuenta de la pantalla puede hacer, como quitar un archivo suyo que quedó
 * suelto, o ponerse al día. Con la traba puesta, la sesión es de la otra cuenta:
 * Storage no la deja quitar el archivo de esta, y el refresco pinta su pantalla
 * y se lleva la traba. Si en vez de volver se recarga, no se hace.
 */
export function cuandoVuelvaLaCuenta(hacer: () => void) {
  alVolver.add(hacer)
}

/**
 * Quita de Storage lo que esta pantalla subió y nadie va a nombrar. La política
 * de cada bucket deja quitarlo solo a su dueño: con la traba puesta la sesión es
 * de la otra cuenta, el borrado volvía vacío y sin error, y el archivo quedaba
 * suelto para siempre (vigesimosexta pasada). Entonces se deja para cuando
 * vuelva la cuenta de la pantalla. Si tampoco así se puede, se queda: nadie más
 * lo ve.
 */
export async function quitarConLaCuenta(quitar: () => Promise<unknown>) {
  const intentar = () => quitar().catch(() => null)
  if (laPestanaEsDeOtraCuenta()) cuandoVuelvaLaCuenta(() => void intentar())
  else await intentar()
}

/**
 * Para seguir una cadena de pasos (subir y anotar, fila por fila, tanda por
 * tanda): lanza `OtraCuentaEnLaPestana` si la sesión ya es de otra cuenta. El
 * primer toque se mira en `useAccion` y `salio()`, pero lo que sigue sale con la
 * sesión que haya en ese momento: el comprobante de la OC quedaba subido por la
 * cuenta que entró en otra pestaña a media subida (vigesimotercera pasada).
 */
export function seguirConLaCuentaDeLaPestana() {
  if (laPestanaEsDeOtraCuenta()) throw new OtraCuentaEnLaPestana()
}

/** Lo que se dice cuando el paso que sigue a uno que ya quedó no sale porque entró otra cuenta. */
export const ENTRO_OTRA_CUENTA = 'En otra pestaña entró otra cuenta.'

/**
 * Lo que dice una ventana cuya cadena cortó la traba sin que quedara nada (la
 * orden nueva, «Dar código y cargar la OT», la cotización, y toda cadena que va
 * por `useAccion`: los pagos de Tesorería, las boletas…). Con el botón apagado
 * mientras enviaba, el cursor había caído a la página, y al volver la cuenta la
 * ventana seguía llena sin decir que no se guardó (vigesimoquinta pasada). El
 * aviso nace con la traba puesta: al volver, el cursor va a él.
 */
export const NO_SE_GUARDO_OTRA_CUENTA = 'No se guardó: en otra pestaña entró otra cuenta. Cuando vuelva la tuya, vuelve a enviarlo.'

/**
 * El paso que sigue a uno que ya quedó (el comprobante de la OC recién
 * emitida, el contrato del subcontrato recién registrado). Si la sesión cambió,
 * no lanza: lo que sí quedó no se diría y la ventana seguiría abierta como si
 * nada. Devuelve `ENTRO_OTRA_CUENTA` para que se diga qué falta y dónde hacerlo.
 */
export async function pasoTrasLoQueQuedo<T>(paso: () => Promise<ResultadoAccion<T>>): Promise<ResultadoAccion<T>> {
  try {
    return await paso()
  } catch (e) {
    if (e instanceof OtraCuentaEnLaPestana) return { ok: false, error: ENTRO_OTRA_CUENTA }
    throw e
  }
}

/**
 * Pone la pantalla al día tras un envío, salvo con la traba puesta: el refresco
 * la pintaba con la cuenta que entró en la otra pestaña, se llevaba la traba sin
 * que nadie recargara y anunciaba «Volvió la cuenta de» la que nunca estuvo
 * (vigesimotercera pasada). Entonces espera a que vuelva la de la pantalla,
 * como `RefrescoAlVolver`.
 */
export function refrescarSiEsDeLaPestana(router: { refresh(): void }) {
  if (!laPestanaEsDeOtraCuenta()) return router.refresh()
  cuandoVuelvaLaCuenta(() => startTransition(() => router.refresh()))
}

/**
 * Lo mismo para la pantalla a la que lleva un envío (la orden recién abierta, el
 * subcontrato recién registrado): con la traba puesta, se pintaría con la cuenta
 * que entró y se llevaría la traba. Espera a que vuelva la de la pantalla.
 *
 * Y va solo si la persona sigue esperando ese envío (`laIdaSigueEnPie`, con la
 * `Partida` que `useAccion` le da a `alTerminar`). Si no, `siNoVa` lo dice
 * arriba con su enlace (`IdaQueNoSalio`): «El subcontrato quedó registrado. Ver
 * el subcontrato». Sin `siNoVa` no se dice: la ida era lo que la persona pidió
 * (abrir un aviso), y ya pidió otra cosa. Con `juntoAlBoton`, el formulario de
 * página entera ya lo dice junto a su botón trabado (`YaQuedo`), y arriba se
 * calla mientras la persona siga en él.
 *
 * La ida que sí sale a otro documento se lleva la línea de antes: quedaba sobre
 * la pantalla del segundo subcontrato hablando del primero, y se leía como suya
 * (H1 de diseño y H3 de funcionalidad de la trigesimonovena pasada); la que no
 * sale pone la suya. La de un aviso (sin `siNoVa`) no la toca, salga o no: lo
 * que dice sigue siendo cierto y nada lo reemplaza, y si la persona abrió el
 * aviso mientras su formulario entraba, es lo único que se lo dice.
 */
export function navegarSiEsDeLaPestana(
  router: { push(url: string): void },
  url: string,
  desde: Partida,
  siNoVa?: { dice: string; enlace: string; juntoAlBoton?: boolean; porOmision?: Record<string, string> },
) {
  const siVa = () => {
    if (laIdaSigueEnPie(desde)) {
      if (siNoVa) ponerIdaQueNoSalio(null)
      return true
    }
    if (siNoVa) {
      const { juntoAlBoton, ...dicho } = siNoVa
      ponerIdaQueNoSalio({ ...dicho, url, dichaEn: juntoAlBoton ? desde.direccion : undefined })
    }
    return false
  }
  if (!laPestanaEsDeOtraCuenta()) {
    if (!siVa()) return
    anotarQueSeVa(url)
    return router.push(url)
  }
  // Cuando vuelva la cuenta se mira otra vez: la ida no sale minutos después
  // encima de lo que la persona hizo entretanto.
  const ir = () => {
    if (siVa()) startTransition(() => router.push(url))
  }
  navegaciones.set(ir, () => laIdaSigueEnPie(desde))
  cuandoVuelvaLaCuenta(ir)
}

function vigilar(avisar: () => void) {
  vigias.add(avisar)
  return () => {
    vigias.delete(avisar)
  }
}

/** El aviso de que en otra pestaña entró otra cuenta, o `null` si esta pantalla es de la sesión. */
export function useOtraCuentaEnLaPestana() {
  return useSyncExternalStore(
    vigilar,
    () => otraCuenta,
    () => null,
  )
}

/**
 * Con el puesto de las dos cuentas, que es como las nombra el menú, y con el
 * nombre si las dos son del mismo puesto. Lo que no pierde lo escrito va
 * primero: recargar lo pierde, y antes se ofrecía primero y sin decirlo
 * (vigesimosegunda pasada).
 */
function textoOtraCuenta(usuarioQueEntro: string) {
  const pintada = cuentaDeLaPestana ? conocidas.get(cuentaDeLaPestana) : undefined
  if (!pintada) {
    return 'Esta pantalla se abrió con otra cuenta que la que entró en otra pestaña: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con la anterior en esa pestaña. Si recargas, sigues con la que entró y se pierde lo escrito aquí.'
  }
  const entro = conocidas.get(usuarioQueEntro)
  const mismoPuesto = entro?.puesto === pintada.puesto
  const nombrar = (c: { puesto: string; nombre: string }) => (mismoPuesto && c.nombre ? `${c.nombre} (${c.puesto})` : c.puesto)
  const aqui = nombrar(pintada)
  const alla = entro && (!mismoPuesto || entro.nombre) ? nombrar(entro) : null
  if (!alla) {
    return `Esta pantalla se abrió con la cuenta de ${aqui}, y en otra pestaña entró otra: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${aqui} en esa pestaña. Si recargas, sigues con la cuenta que entró y se pierde lo escrito aquí.`
  }
  return `Esta pantalla se abrió con la cuenta de ${aqui}, y en otra pestaña entró la de ${alla}: desde aquí no se envía nada. Para seguir aquí con lo escrito, vuelve a entrar con ${aqui} en esa pestaña. Si recargas, sigues con ${alla} y se pierde lo escrito aquí.`
}

/**
 * Mientras se envía, el botón que envía se apaga —y, donde la ventana los traba
 * con `fieldset disabled`, también los campos— y el cursor se pierde. Si el
 * envío termina en un rechazo, el cursor va a lo que lo explica
 * —el campo que la base rechazó o el aviso—, para que el teclado y el lector de
 * pantalla sigan donde estaban. `destino` se mira en ese momento: el aviso
 * todavía no existe cuando empieza el envío.
 */
export function useCursorAlRechazo(enviando: boolean, rechazo: string | null, destino: () => HTMLElement | null) {
  const enviaba = useRef(false)
  useEffect(() => {
    if (enviando) {
      enviaba.current = true
      return
    }
    if (!enviaba.current) return
    enviaba.current = false
    if (rechazo) destino()?.focus()
  }, [enviando, rechazo, destino])
}
