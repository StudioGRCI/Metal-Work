'use client'

import { useState } from 'react'
import { Boton } from '@/components/ui/boton'
import { AreaTexto, Campo, Entrada, Seleccion } from '@/components/ui/campos'
import { CRITERIOS_DISENO } from '@/lib/dominio/evaluacion-diseno'
import { useEnvio } from '@/lib/envio'
import { crearEvaluacionDiseno } from './acciones'

export function FormularioEvaluacion({ hoy }: { hoy: string }) {
  const [clave, setClave] = useState(() => crypto.randomUUID())
  const envio = useEnvio(crearEvaluacionDiseno, () => setClave(crypto.randomUUID()))
  return <form key={clave} onSubmit={envio.alEnviar} className="space-y-5">
    <input type="hidden" name="id" value={clave} />
    <div className="grid gap-3 sm:grid-cols-2">
      <Campo etiqueta="Nombre de la persona evaluada" htmlFor="ev-nombre" requerido>
        <Entrada id="ev-nombre" name="evaluado_nombre" maxLength={120} required />
      </Campo>
      <Campo etiqueta="Puesto" htmlFor="ev-puesto" requerido>
        <Entrada id="ev-puesto" name="puesto" maxLength={100} required placeholder="Ej.: Diseñador" />
      </Campo>
      <Campo etiqueta="Fecha de ingreso" htmlFor="ev-ingreso">
        <Entrada id="ev-ingreso" name="fecha_ingreso" type="date" />
      </Campo>
      <Campo etiqueta="Fecha de evaluación" htmlFor="ev-fecha" requerido>
        <Entrada id="ev-fecha" name="fecha_evaluacion" type="date" defaultValue={hoy} required />
      </Campo>
    </div>
    <p className="text-sm text-texto-suave">Califica de 1 (muy bajo) a 5 (muy alto). Los 20 criterios suman hasta 100 puntos.</p>
    <div className="space-y-2">
      {CRITERIOS_DISENO.map((criterio, i) => {
        const nuevoGrupo = i === 0 || criterio.grupo !== CRITERIOS_DISENO[i - 1].grupo
        return <div key={i}>
          {nuevoGrupo && <h3 className="mb-2 mt-4 text-sm font-semibold text-acento">{criterio.grupo}</h3>}
          <div className="grid gap-2 rounded-[var(--radius-base)] border border-borde p-3 sm:grid-cols-[minmax(0,1fr)_8rem] sm:items-center">
            <label htmlFor={`ev-puntaje-${i}`} className="text-sm text-texto">{i + 1}. {criterio.nombre}</label>
            <Seleccion id={`ev-puntaje-${i}`} name={`puntaje_${i}`} defaultValue="" required aria-label={`Puntaje: ${criterio.nombre}`}>
              <option value="" disabled>Calificar</option>
              {[1, 2, 3, 4, 5].map(valor => <option value={valor} key={valor}>{valor}</option>)}
            </Seleccion>
          </div>
        </div>
      })}
    </div>
    <Campo etiqueta="Comentarios" htmlFor="ev-comentarios">
      <AreaTexto id="ev-comentarios" name="comentarios" maxLength={3000} />
    </Campo>
    {envio.error && <p role="alert" className="text-sm text-peligro">{envio.error}</p>}
    {envio.resultado?.ok && <p role="status" className="text-sm text-exito">{envio.resultado.mensaje}</p>}
    <Boton type="submit" cargando={envio.enviando}>Guardar evaluación</Boton>
  </form>
}
