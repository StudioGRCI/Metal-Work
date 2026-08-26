import type { Columna } from '@/lib/dominio/informes'
import { ESTADO_OT, definir } from '@/lib/dominio/estados'
import { cantidad, fecha, moneda, numero, porcentaje } from '@/lib/format'

/** Cómo se ve una celda del informe según el formato que declara su columna. */
export function celda(valor: unknown, columna: Columna) {
  if (valor === null || valor === undefined || valor === '') return '—'

  switch (columna.formato) {
    case 'moneda':
      return moneda(Number(valor))
    case 'horas':
      return `${cantidad(valor as number)} h`
    case 'numero':
      return numero(valor as number, Number.isInteger(Number(valor)) ? 0 : 1)
    case 'porcentaje':
      return porcentaje(valor as number, 1)
    case 'fecha':
      return fecha(valor as string)
    case 'si_no':
      return valor ? 'Sí' : 'No'
    case 'estado_ot':
      return definir(ESTADO_OT, String(valor)).etiqueta
    default:
      return String(valor)
  }
}

/** Las columnas numéricas van a la derecha, donde se comparan de un vistazo. */
export function alineaDerecha(columna: Columna) {
  return ['moneda', 'numero', 'horas', 'porcentaje'].includes(columna.formato ?? 'texto')
}

/** Suma una columna del informe; devuelve null si no se totaliza. */
export function total(filas: Record<string, unknown>[], columna: Columna) {
  if (!columna.totaliza) return null
  return filas.reduce((suma, f) => suma + Number(f[columna.clave] ?? 0), 0)
}

/**
 * El informe en CSV para abrirlo en Excel.
 *
 * Va con punto y coma y con BOM porque el Excel en español separa por punto y
 * coma: con coma, todo el informe cae en una sola columna y hay que reprocesarlo
 * a mano. El BOM es lo que hace que las tildes y las eñes se vean bien.
 */
export function aCsv(filas: Record<string, unknown>[], columnas: Columna[]) {
  const escapar = (valor: unknown) => {
    if (valor === null || valor === undefined) return ''
    const texto = String(valor)
    return /[";\n\r]/.test(texto) ? `"${texto.replace(/"/g, '""')}"` : texto
  }

  const lineas = [
    columnas.map((c) => escapar(c.titulo)).join(';'),
    ...filas.map((f) =>
      columnas
        .map((c) => {
          const valor = f[c.clave]
          if (c.formato === 'si_no') return valor ? 'Sí' : 'No'
          if (c.formato === 'estado_ot') return escapar(definir(ESTADO_OT, String(valor)).etiqueta)
          // Los números salen crudos, con coma decimal: así Excel los suma.
          if (typeof valor === 'number') return String(valor).replace('.', ',')
          return escapar(valor)
        })
        .join(';'),
    ),
  ]

  return `﻿${lineas.join('\r\n')}\r\n`
}
