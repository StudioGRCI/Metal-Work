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
