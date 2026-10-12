/**
 * Lectura del formato de conteo inicial: el inventario físico con el que el
 * almacén arranca en el sistema. Solo da forma a lo escrito; si el código
 * existe y cómo entra cada fila lo decide quien lo carga, contra la base.
 */

import { numeroDeCelda, textoDeCelda, type Celda } from './planilla-almacen'

/** Fila donde están los encabezados del formato; lo contado empieza debajo. */
export const FILA_ENCABEZADO_CONTEO = 4

/** Cuántas filas registra cada llamada: la pantalla las manda por tandas y muestra el avance. */
export const TANDA_CONTEO = 100

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
