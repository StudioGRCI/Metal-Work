/** Redondeo por línea: el total de la OC es la suma de los importes impresos. */
export function importeCompra(cantidad: number, precio: number | null) {
  return Math.round((cantidad*(precio??0)+Number.EPSILON)*100)/100
}

export function totalCompra(lineas: {cantidad:number;precio:number|null}[]) {
  return lineas.reduce((centimos,linea)=>centimos+Math.round(importeCompra(linea.cantidad,linea.precio)*100),0)/100
}

/** El IGV de una compra con factura, redondeado al céntimo como en la OC impresa. */
export function igvCompra(subtotal: number) {
  return Math.round(subtotal * 18) / 100
}
