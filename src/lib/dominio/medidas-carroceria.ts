/**
 * Las medidas técnicas de referencia de una carrocería del catálogo, en un
 * renglón: modelo, largo × ancho × alto, capacidad y peso neto.
 *
 * Vive aquí y no junto a la ventana de medidas porque la usan las dos
 * pantallas: Carrocerías (componente de servidor) y Configuración (de
 * cliente). Una función exportada de un módulo `'use client'` no se puede
 * llamar desde el servidor.
 */
export type MedidasDeCarroceria = {
  modelo: string | null
  largo_m: number | null
  ancho_m: number | null
  alto_m: number | null
  capacidad: string | null
  peso_neto_tn: number | null
}

export function resumenMedidas(c: MedidasDeCarroceria): string | null {
  const medidas = [c.largo_m, c.ancho_m, c.alto_m].filter((m) => m !== null)
  const partes = [
    c.modelo,
    medidas.length > 0 ? `${medidas.join(' × ')} m` : null,
    c.capacidad,
    c.peso_neto_tn ? `${c.peso_neto_tn} tn` : null,
  ].filter(Boolean)
  return partes.length > 0 ? partes.join(' · ') : null
}

/**
 * El nombre de una carrocería como se compara: mayúsculas, sin tildes, con
 * guiones bajos y entero. Con él decide el alta si ya estaba
 * (`crearCarroceria`), la orden nueva busca la que volvió sin decir si entró, y
 * la base no deja renombrar una con el de otra (`fn_carroceria_nombre_sin_repetir`).
 */
export const nombreDeCarroceria = (nombre: string) =>
  nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

/**
 * El código de una carrocería nueva, que sale de su nombre recortado a 40. Solo
 * al darla de alta: después es el de la empresa y no sigue al nombre. Para
 * saber si dos se llaman igual, `nombreDeCarroceria`: el recorte confundía dos
 * nombres largos que solo difieren al final.
 */
export const codigoDeCarroceria = (nombre: string) => nombreDeCarroceria(nombre).slice(0, 40)
