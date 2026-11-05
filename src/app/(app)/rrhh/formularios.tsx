'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { UserMinus } from 'lucide-react'
import { Boton } from '@/components/ui/boton'
import { Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { Ventana } from '@/components/ui/ventana'
import { useEnvio } from '@/lib/envio'
import { moneda } from '@/lib/format'
import { crearPlanilla, agregarPersona, cerrarPlanilla, quitarPersona } from './acciones'

export function NuevaPlanilla() {
  const {alEnviar,enviando,error,resultado}=useEnvio(crearPlanilla)
  return <form onSubmit={alEnviar} className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
    <Campo etiqueta="Tipo" htmlFor="pl-tipo"><Seleccion id="pl-tipo" name="tipo"><option value="TALLER">Taller</option><option value="ADMINISTRATIVA">Administrativa</option><option value="SUBCONTRATOS">Subcontratos</option></Seleccion></Campo>
    <Campo etiqueta="Primer día del mes" htmlFor="pl-periodo" requerido><Entrada id="pl-periodo" name="periodo" type="date" required /></Campo>
    <Campo etiqueta="Moneda" htmlFor="pl-moneda"><Seleccion id="pl-moneda" name="moneda"><option value="PEN">Soles</option><option value="USD">Dólares</option></Seleccion></Campo>
    <input type="hidden" name="observacion" value="" /><Boton type="submit" cargando={enviando}>Crear planilla</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form>
}

export function AgregarPersona({planillaId,tipo}:{planillaId:string;tipo:string}) {
  // Vacío al entrar: sin documento, un segundo toque la agregaba dos veces.
  const formulario=useRef<HTMLFormElement>(null)
  const {alEnviar,enviando,error,resultado}=useEnvio(agregarPersona,()=>formulario.current?.reset(),{documento:planillaId})
  return <form ref={formulario} onSubmit={alEnviar} className="grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
    <input type="hidden" name="planilla_id" value={planillaId} />
    <Campo etiqueta={tipo==='SUBCONTRATOS'?'Proveedor o subcontrato':'Nombre completo'} htmlFor={`pl-nom-${planillaId}`} requerido><Entrada id={`pl-nom-${planillaId}`} name="nombre" minLength={3} maxLength={160} required /></Campo>
    <Campo etiqueta="Documento" htmlFor={`pl-doc-${planillaId}`}><Entrada id={`pl-doc-${planillaId}`} name="documento" maxLength={20} /></Campo>
    <Campo etiqueta="Importe del mes" htmlFor={`pl-monto-${planillaId}`} requerido><Entrada id={`pl-monto-${planillaId}`} name="monto" type="number" min={0} step="0.01" inputMode="decimal" required /></Campo>
    <Boton type="submit" tamano="sm" cargando={enviando}>Agregar</Boton>
    {error&&<p role="alert" className="text-xs text-peligro sm:col-span-4">{error}</p>}{resultado?.ok&&<p role="status" className="text-xs text-exito sm:col-span-4">{resultado.mensaje}</p>}
  </form>
}

/**
 * Cerrar la planilla del mes no tiene vuelta: se confirma en una ventana que
 * dice qué pasa con el costo. La de taller reparte su ajuste entre los códigos.
 */
export function CerrarPlanilla({
  id,
  titulo,
  deTaller,
  soloRegistro,
  ajusteDesde,
  entra,
  sinDestino,
  mesTerminado,
}: {
  id: string
  /** «planilla de taller de 10/2026». */
  titulo: string
  deTaller: boolean
  /** La de taller de antes de noviembre de 2026: queda como registro, sin ajuste. */
  soloRegistro: boolean
  /** «noviembre de 2026»: el mes en que empieza el ajuste, leído de la base. */
  ajusteDesde: string
  /** Lo que el ajuste lleva a los códigos al cerrar (taller). */
  entra: number
  /** Personas cuyo ajuste no llega a ningún código: el mes no tiene horas en los reportes. */
  sinDestino: number
  /** El mes de la planilla ya terminó: si no, llegan horas después y el ajuste se rehace. */
  mesTerminado: boolean
}) {
  const [abierta, setAbierta] = useState(false)
  const {alEnviar,enviando,error,resultado}=useEnvio(cerrarPlanilla, () => setAbierta(false))
  const ajusta = deTaller && !soloRegistro
  const queHace = ajusta
    ? `Al cerrarla, ${moneda(entra)} de ajuste entran a la mano de obra de los códigos del mes, por sus horas.`
    : soloRegistro
      ? `Queda como registro: el ajuste de la planilla de taller empieza en ${ajusteDesde}.`
      : 'Queda como registro: su costo no entra por aquí a los códigos.'
  return <div className="space-y-2">
    <Boton type="button" tamano="sm" onClick={() => setAbierta(true)}>Cerrar planilla</Boton>
    {resultado?.ok&&<p role="status" className="text-xs text-exito">{resultado.mensaje}</p>}
    <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Cerrar la ${titulo}`}
      descripcion={`${queHace} Una planilla cerrada no se vuelve a abrir.`} ancho="sm">
      <form onSubmit={alEnviar} className="space-y-4">
        <input type="hidden" name="planilla_id" value={id} />
        {ajusta && !mesTerminado && (
          <p className="text-sm text-aviso">El mes todavía no termina: las horas que lleguen después rehacen el ajuste solas.</p>
        )}
        {ajusta && sinDestino > 0 && (
          <p className="text-sm text-aviso">
            {sinDestino === 1 ? 'El costo de 1 persona no llega' : `El costo de ${sinDestino} personas no llega`} a ningún código: ese mes no tiene horas en
            los reportes.
          </p>
        )}
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={() => setAbierta(false)}>Cancelar</Boton>
          <Boton type="submit" cargando={enviando}>Cerrar planilla</Boton>
        </div>
      </form>
    </Ventana>
  </div>
}

/**
 * Quitar a alguien de la planilla en borrador: corrige una carga equivocada
 * —se eligió a quien no iba, o entró con el nombre mal escrito—. Quien dejó de
 * trabajar se da de baja en Personal.
 */
export function QuitarPersona({ personaId, nombre }: { personaId: string; nombre: string }) {
  const [abierta, setAbierta] = useState(false)
  const { alEnviar, enviando, error } = useEnvio(quitarPersona, () => setAbierta(false))
  return <>
    <Boton type="button" tamano="sm" variante="contornoPeligro" onClick={() => setAbierta(true)} aria-label={`Quitar a ${nombre} de la planilla`}>
      <UserMinus aria-hidden className="size-4" />Quitar de la planilla
    </Boton>
    <Ventana abierta={abierta} alCerrar={() => setAbierta(false)} titulo={`Quitar a ${nombre}`}
      descripcion="Sale de esta planilla y su costo deja de entrar a los códigos. Es para corregir una carga equivocada.">
      <form onSubmit={alEnviar} className="space-y-4">
        <p className="text-sm text-texto-suave">
          Si dejó de trabajar, no la quites: dale de baja en <Link href="/rrhh/personal" className="font-medium text-acento underline underline-offset-2">Personal</Link>.
        </p>
        <input type="hidden" name="persona_id" value={personaId} />
        {error && <p role="alert" className="text-sm text-peligro">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Boton type="button" variante="secundario" onClick={() => setAbierta(false)}>Cancelar</Boton>
          <Boton type="submit" variante="peligro" cargando={enviando}>Quitar de la planilla</Boton>
        </div>
      </form>
    </Ventana>
  </>
}
