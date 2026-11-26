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
      <span className="text-peligro">
        Venció el {fecha(dia)}, <span className="whitespace-nowrap">{diasDelVencimiento(faltan)}</span>
      </span>
    )
  }
  if (saldo > 0 && faltan === 0) {
    return (
      <span className="text-aviso">
        Vence hoy
      </span>
    )
  }
  if (saldo > 0) {
    return (
      <span>
        Vence el {fecha(dia)}, <span className="whitespace-nowrap">{diasDelVencimiento(faltan)}</span>
      </span>
    )
  }
  return <>Vence el {fecha(dia)}</>
}
