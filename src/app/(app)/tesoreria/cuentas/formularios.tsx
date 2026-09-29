'use client'

import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { useEnvio } from '@/lib/envio'
import { crearCuentaCobrar, registrarCobro, registrarPago } from './acciones'

export function NuevaCuenta({ordenes}:{ordenes:{id:string;numero:string}[]}) {
  const {alEnviar,enviando,error,resultado}=useEnvio(crearCuentaCobrar)
  return <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
    <Campo etiqueta="OT" htmlFor="cc-ot" requerido><Seleccion id="cc-ot" name="orden_id" required defaultValue=""><option value="" disabled>Elige la OT</option>{ordenes.map(o=><option key={o.id} value={o.id}>{o.numero}</option>)}</Seleccion></Campo>
    <Campo etiqueta="Número de factura" htmlFor="cc-doc" requerido><Entrada id="cc-doc" name="numero_documento" required minLength={3} maxLength={80} /></Campo>
    <Campo etiqueta="Moneda" htmlFor="cc-moneda"><Seleccion id="cc-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
    <Campo etiqueta="Emisión" htmlFor="cc-emision" requerido><Entrada id="cc-emision" type="date" name="fecha_emision" required /></Campo>
    <Campo etiqueta="Vencimiento" htmlFor="cc-vencimiento" requerido><Entrada id="cc-vencimiento" type="date" name="fecha_vencimiento" required /></Campo>
    <Campo etiqueta="Total" htmlFor="cc-total" requerido><Entrada id="cc-total" name="total" type="number" inputMode="decimal" min="0.01" step="0.01" required /></Campo>
    <Campo etiqueta="Observación" htmlFor="cc-nota" className="sm:col-span-2 lg:col-span-3"><Entrada id="cc-nota" name="observacion" maxLength={1000} /></Campo>
    <div className="sm:col-span-2 lg:col-span-3 space-y-2"><Boton type="submit" cargando={enviando}>Crear cuenta por cobrar</Boton>{error&&<p role="alert" className="text-sm text-peligro">{error}</p>}{resultado?.ok&&<p role="status" className="text-sm text-exito">{resultado.mensaje}</p>}</div>
  </form>
}

export function Movimiento({id,tipo,saldo}:{id:string;tipo:'cobro'|'pago';saldo:number}) {
  const {alEnviar,enviando,error,resultado}=useEnvio(tipo==='cobro'?registrarCobro:registrarPago)
  return <details className="mt-2"><summary className="cursor-pointer text-sm font-medium text-acento">Registrar {tipo}</summary><form onSubmit={alEnviar} className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <input type="hidden" name="id" value={id} />
    <Campo etiqueta="Fecha" htmlFor={`${tipo}-fecha-${id}`} requerido><Entrada id={`${tipo}-fecha-${id}`} type="date" name="fecha" required /></Campo>
    <Campo etiqueta="Importe" htmlFor={`${tipo}-monto-${id}`} requerido><Entrada id={`${tipo}-monto-${id}`} type="number" inputMode="decimal" min="0.01" max={saldo} step="0.01" name="monto" required /></Campo>
    <Campo etiqueta="Referencia bancaria" htmlFor={`${tipo}-ref-${id}`} requerido><Entrada id={`${tipo}-ref-${id}`} name="referencia" minLength={3} maxLength={120} required /></Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Guardar {tipo}</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form></details>
}
