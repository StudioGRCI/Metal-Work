import { diasHasta, fecha, type CodigoMoneda } from '@/lib/format'

export function codigoMoneda(codigo: string | null): CodigoMoneda {
  return codigo === 'USD' ? 'USD' : 'PEN'
}

/** El vencimiento dicho como se lee: lo que ya venció con saldo se marca en rojo. */
export function Vencimiento({ dia, saldo }: { dia: string | null; saldo: number }) {
  const faltan = diasHasta(dia)
  if (faltan === null) return <>Sin vencimiento</>
  if (saldo > 0 && faltan < 0) {
    return (
      <span className="text-peligro">
        Venció el {fecha(dia)}, hace {-faltan} {faltan === -1 ? 'día' : 'días'}
      </span>
    )
  }
  if (saldo > 0 && faltan === 0) return <span className="text-aviso">Vence hoy</span>
  return <>Vence el {fecha(dia)}</>
}
