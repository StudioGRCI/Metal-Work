/**
 * Lectura del formato de conteo inicial: el inventario físico con el que el
 * almacén arranca en el sistema. Solo da forma a lo escrito; si el código
 * existe y cómo entra cada fila lo decide quien lo carga, contra la base.
 */

import { fecha as fechaCorta } from '@/lib/format'

import { numeroDeCelda, textoDeCelda, type Celda } from './planilla-almacen'

/** Fila donde están los encabezados del formato; lo contado empieza debajo. */
export const FILA_ENCABEZADO_CONTEO = 4

/** Cuántas filas registra cada llamada: la pantalla las manda por tandas y muestra el avance. */
export const TANDA_CONTEO = 100

/** Lo más viejo que puede ser un conteo: lo que pasó desde entonces ya movió los saldos. */
export const DIAS_DEL_CONTEO = 31

/**
 * Por qué la fecha del conteo no sirve; `null` si sirve. La pantalla lo dice en
 * la fecha antes de leer el Excel y el servidor lo vuelve a mirar con las mismas
 * palabras: el rechazo salía en el campo del archivo y quien lo veía cambiaba un
 * Excel que estaba bien (auditoría del 2026-10-22).
 */
export function motivoDeFechaDeConteo(fecha: string, hoy: string, desde: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return 'Indica la fecha en que se hizo el conteo.'
  // Con el día del que revisa: el del equipo puede ir adelantado.
  if (fecha > hoy) return `La fecha del conteo es posterior a hoy, ${fechaCorta(hoy)}.`
  if (fecha < desde) {
    return `El conteo es de hace más de ${DIAS_DEL_CONTEO} días: lo que pasó desde entonces ya movió los saldos. Vuelve a contar.`
  }
  return null
}

export type FilaConteoLeida = {
  /** La fila de Excel, para que quien contó la encuentre en su archivo. */
  fila: number
  codigo: string
  contado: number | null
  precio: number | null
  moneda: 'PEN' | 'USD'
  errores: string[]
}

/**
 * Las filas contadas: las que tienen algo en «Cantidad contada». Un material
 * que no se contó se deja en blanco y no se toca; un 0 escrito sí es un conteo.
 */
export function leerHojaConteo(filas: Celda[][]): FilaConteoLeida[] {
  const inicio = filas.findIndex((f) => textoDeCelda(f[0]).toLowerCase().startsWith('código'))
  if (inicio < 0) throw new Error('La hoja «Conteo» no tiene el encabezado del formato. Descárgalo de nuevo desde el kardex.')
  const salida: FilaConteoLeida[] = []
  filas.slice(inicio + 1).forEach((f, i) => {
    if (textoDeCelda(f[4]) === '') return
    const errores: string[] = []
    const codigo = textoDeCelda(f[0])
    if (!codigo) errores.push('Falta el código del material.')
    const contado = numeroDeCelda(f[4])
    if (contado === null || contado < 0) errores.push('La cantidad contada tiene que ser un número de 0 en adelante.')
    else if (Math.round(contado * 1000) !== contado * 1000) errores.push('La cantidad admite hasta 3 decimales.')
    const precio = numeroDeCelda(f[5])
    if (textoDeCelda(f[5]) && (precio === null || precio < 0)) errores.push('El precio no se entiende: déjalo vacío si no lo sabes.')
    const moneda = textoDeCelda(f[6]).toLowerCase()
    if (moneda && !['soles', 'dólares', 'dolares', 'pen', 'usd'].includes(moneda)) errores.push('Moneda: Soles o Dólares.')
    salida.push({
      fila: inicio + i + 2,
      codigo,
      contado: contado !== null && contado >= 0 ? contado : null,
      precio: precio !== null && precio >= 0 ? Math.round(precio * 10000) / 10000 : null,
      moneda: ['dólares', 'dolares', 'usd'].includes(moneda) ? 'USD' : 'PEN',
      errores,
    })
  })
  return salida
}

/** «Conteo inicial del 15/10/2026»: el documento del ingreso o el motivo del ajuste. */
export function motivoConteoInicial(fecha: string) {
  return `Conteo inicial del ${fecha.slice(8, 10)}/${fecha.slice(5, 7)}/${fecha.slice(0, 4)}`
}
