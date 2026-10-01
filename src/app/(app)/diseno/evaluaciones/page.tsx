import Link from 'next/link'
import { Plus } from 'lucide-react'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { type EvaluacionEnLista, listarEvaluacionesDiseno } from '@/lib/datos/evaluaciones-diseno'
import { ESTADO_EVALUACION_DISENO, definir } from '@/lib/dominio/estados'
import { puntajeDiseno } from '@/lib/dominio/evaluacion-diseno'
import { fecha } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

export const metadata = { title: 'Evaluación de desempeño · Diseño e Ingeniería' }

export default async function PaginaEvaluacionesDiseno() {
  const perfil = await exigirPermiso(['diseno.evaluar', 'administracion.recibir_evaluacion'])
  const evalua = puede(perfil, 'diseno.evaluar')
  const recibe = puede(perfil, 'administracion.recibir_evaluacion')
  const evaluaciones = await listarEvaluacionesDiseno()

  const porRecibir = evaluaciones.filter((e) => e.estado === 'ENVIADA')
  const mias = evaluaciones.filter((e) => e.evaluador_id === perfil.id)
  const teToca = mias.filter((e) => e.estado === 'BORRADOR' || e.estado === 'OBSERVADA')
  // Administración ya tiene arriba las que esperan su recibo; abajo, su historial.
  const soloRecibe = recibe && !evalua
  const soloEvalua = evalua && !recibe
  const historial = soloRecibe ? evaluaciones.filter((e) => e.estado !== 'ENVIADA') : soloEvalua ? mias : evaluaciones

  return (
    <>
      <EncabezadoPagina
        titulo="Evaluación de desempeño de Diseño"
        descripcion={recibe && !evalua
          ? 'Las evaluaciones que Diseño e Ingeniería te envía. Solo las ven quien las hizo y Administración.'
          : 'La jefatura de Diseño e Ingeniería evalúa a su personal y la envía a Administración. Solo la ven quien la hizo y Administración.'}
        acciones={evalua && (
          <EnlaceBoton href="/diseno/evaluaciones/nueva"><Plus aria-hidden className="size-4" /> Nueva evaluación</EnlaceBoton>
        )}
      />
      <div className="space-y-5">
        {recibe && (
          <Tarjeta>
            <TarjetaCabecera
              titulo="Por recibir"
              descripcion="Revísala y márcala como recibida, o devuélvela a Diseño con lo que hay que corregir."
            />
            <TarjetaCuerpo className="p-0">
              <ListaEvaluaciones
                filas={porRecibir}
                conEvaluador
                vacio={{ titulo: 'No hay evaluaciones por recibir', descripcion: 'Aparecen aquí apenas Diseño e Ingeniería las envía.' }}
              />
            </TarjetaCuerpo>
          </Tarjeta>
        )}
        {evalua && teToca.length > 0 && (
          <Tarjeta>
            <TarjetaCabecera
              titulo="Te toca"
              descripcion="Borradores sin enviar y evaluaciones que Administración te devolvió para corregir."
            />
            <TarjetaCuerpo className="p-0">
              <ListaEvaluaciones filas={teToca} vacio={{ titulo: '' }} />
            </TarjetaCuerpo>
          </Tarjeta>
        )}
        <Tarjeta>
          <TarjetaCabecera
            titulo={soloEvalua ? 'Mis evaluaciones' : soloRecibe ? 'Recibidas y devueltas' : 'Todas las evaluaciones'}
            descripcion={soloEvalua
              ? 'Las que hiciste, en cualquier estado. Enviada, ya no se corrige salvo que Administración la devuelva.'
              : soloRecibe
                ? 'Las que ya recibiste y las que devolviste a Diseño para corregir.'
                : 'Todas, en cualquier estado.'}
          />
          <TarjetaCuerpo className="p-0">
            <ListaEvaluaciones
              filas={historial}
              conEvaluador={recibe}
              vacio={evalua
                ? { titulo: 'Aún no hay evaluaciones', descripcion: 'Registra la primera con «Nueva evaluación».' }
                : { titulo: 'Todavía no recibiste ninguna', descripcion: 'Las que recibas o devuelvas quedan aquí como historial.' }}
            />
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

function ListaEvaluaciones({ filas, conEvaluador = false, vacio }: {
  filas: EvaluacionEnLista[]
  conEvaluador?: boolean
  vacio: { titulo: string; descripcion?: string }
}) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Evaluado</TH>
          <TH className="hidden sm:table-cell">Fecha</TH>
          {conEvaluador && <TH className="hidden md:table-cell">Evaluador</TH>}
          <TH className="text-right">Puntaje</TH>
          <TH>Estado</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {filas.length === 0 && <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />}
        {filas.map((e) => {
          const estado = definir(ESTADO_EVALUACION_DISENO, e.estado)
          return (
            <TR key={e.id}>
              <TD className="min-w-0">
                <Link href={`/diseno/evaluaciones/${e.id}`} className="font-medium text-acento hover:underline">
                  {e.evaluado_nombre}
                </Link>
                <span className="block text-xs text-texto-suave">
                  {e.puesto} · {e.area_servicio}<span className="sm:hidden"> · {fecha(e.fecha_evaluacion)}</span>
                </span>
              </TD>
              <TD className="hidden whitespace-nowrap sm:table-cell">{fecha(e.fecha_evaluacion)}</TD>
              {conEvaluador && <TD className="hidden md:table-cell">{e.evaluador_nombre ?? '—'}</TD>}
              <TD className="tabular text-right whitespace-nowrap">{puntajeDiseno(e.respuestas)} / 100</TD>
              <TD><Insignia tono={estado.tono}>{estado.etiqueta}</Insignia></TD>
            </TR>
          )
        })}
      </tbody>
    </Tabla>
  )
}
