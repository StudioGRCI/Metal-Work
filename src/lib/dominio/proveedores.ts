import type { Tono } from '@/components/ui/etiqueta-estado'

/**
 * El RUC con su dígito verificador de SUNAT. Es el gemelo de
 * `public.ruc_es_valido` en la base: aquí sirve para avisar mientras se
 * escribe; quien decide es la base, que rechaza el RUC mal copiado aunque la
 * pantalla lo dejara pasar.
 */
export function rucEsValido(ruc: string): boolean {
  if (!/^(10|15|16|17|20)\d{9}$/.test(ruc)) return false
  const pesos = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  const suma = pesos.reduce((total, peso, i) => total + Number(ruc[i]) * peso, 0)
  let digito = 11 - (suma % 11)
  if (digito === 10) digito = 0
  if (digito === 11) digito = 1
  return digito === Number(ruc[10])
}

/** «Contado» o «Crédito a 30 días», como se dice en Logística. */
export function condicionDePago(condicion: string | null | undefined, dias: number | null | undefined): string {
  if (condicion === 'CREDITO') return `Crédito a ${dias ?? 0} ${dias === 1 ? 'día' : 'días'}`
  return 'Contado'
}

type Def = { etiqueta: string; tono: Tono; descripcion: string }

/** El estado de aprobación de una orden de compra, como lo lee Logística. */
export const APROBACION_COMPRA: Record<string, Def> = {
  NO_REQUERIDA: { etiqueta: 'Sin aprobación', tono: 'neutro', descripcion: 'No llegó al monto que pide aprobación.' },
  POR_APROBAR: { etiqueta: 'Por aprobar', tono: 'aviso', descripcion: 'Espera la aprobación antes de enviarse al proveedor.' },
  APROBADA: { etiqueta: 'Aprobada', tono: 'exito', descripcion: 'Aprobada: ya se puede enviar y recibir.' },
  RECHAZADA: { etiqueta: 'Rechazada', tono: 'peligro', descripcion: 'Rechazada: sus líneas volvieron a quedar por comprar.' },
}

/** Una compra que no se envía, no se entrega ni se recibe hasta que se decida. */
export function compraDetenida(aprobacion: string | null | undefined): boolean {
  return aprobacion === 'POR_APROBAR' || aprobacion === 'RECHAZADA'
}

/** Dónde está la compra en manos del conductor. */
export const ESTADO_RECOJO: Record<string, Def> = {
  POR_RECOGER: { etiqueta: 'Por recoger', tono: 'aviso', descripcion: 'Lista para recoger donde el proveedor.' },
  EN_CAMINO: { etiqueta: 'En camino', tono: 'info', descripcion: 'Recogida: falta dejarla en almacén.' },
  EN_ALMACEN: { etiqueta: 'En almacén', tono: 'exito', descripcion: 'Dejada en almacén.' },
}
