import { diasDelVencimiento } from '@/lib/dominio/vencimiento'
import { diasHasta, fecha, type CodigoMoneda } from '@/lib/format'

export function codigoMoneda(codigo: string | null): CodigoMoneda {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

/**
 * El vencimiento dicho como se lee, con sus días (plan 11.1): lo que ya venció
 * con saldo se marca en rojo y dice hace cuántos días; lo que vence después,
 * en cuántos. Los días se cuentan con el día de Lima (`diasHasta`).
 */
export function Vencimiento({ dia, saldo }: { dia: string | null; saldo: number }) {
  const faltan = diasHasta(dia)
  if (faltan === null) return <>Sin vencimiento</>
  if (saldo > 0 && faltan < 0) {
    return (
      <span className="text-peligro" data-dias-vencimiento={faltan}>
        Venció el {fecha(dia)}, {diasDelVencimiento(faltan)}
      </span>
    )
  }
  if (saldo > 0 && faltan === 0) {
    return (
      <span className="text-aviso" data-dias-vencimiento={0}>
        Vence hoy
      </span>
    )
  }
  if (saldo > 0) {
    return (
      <span data-dias-vencimiento={faltan}>
        Vence el {fecha(dia)}, {diasDelVencimiento(faltan)}
      </span>
    )
  }
  return <>Vence el {fecha(dia)}</>
}
