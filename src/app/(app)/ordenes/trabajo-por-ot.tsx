import Link from 'next/link'

import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Pliegue } from '@/components/ui/seccion-desplegable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { trabajoDeDisenoPorOt, type TrabajoEnLaOt } from '@/lib/datos/informe-diseno'
import { estadoDeOrden } from '@/lib/dominio/estados'
import { codigoInternoOt, nombreTarea, siglaCarroceria } from '@/lib/dominio/informe-diseno'
import { fecha } from '@/lib/format'

/** Cuántas OT con actividades se ven de entrada; las demás, en un pliegue. */
const A_LA_VISTA = 5

/** «26/11/2026», o las dos fechas en las actividades de antes, que se planificaban. */
const dia = (inicio: string, fin: string) => (inicio === fin ? fecha(inicio) : `${fecha(inicio)} al ${fecha(fin)}`)

/** Como en el formato («código/OT»); sin código interno, el número entero de la OT. */
const nombreDeLaOt = (o: TrabajoEnLaOt) => (o.codigo_interno ? codigoInternoOt(o.codigo_interno, o.numero) : `OT ${o.numero}`)

function Cabecera({ o }: { o: TrabajoEnLaOt }) {
  const estado = estadoDeOrden(o.estado_ot)
  const sigla = siglaCarroceria(o.tipo_unidad)
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="font-semibold break-all sm:break-normal">{nombreDeLaOt(o)}</span>
      {sigla !== '—' && <span className="text-texto-suave">· {sigla}</span>}
      <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
    </span>
  )
}

/** Una OT con lo que anotó en ella, de la más reciente a la más antigua. */
function OtConActividades({ o }: { o: TrabajoEnLaOt }) {
  const n = o.actividades.length
  return (
    <Pliegue
      enCaja
      data-trabajo-ot={o.numero}
      titulo={
        <span className="block">
          <Cabecera o={o} />
          <span className="mt-0.5 block text-xs font-normal text-texto-suave">
            {n} {n === 1 ? 'actividad' : 'actividades'} · la última el {fecha(o.actividades[0].fecha_inicio)}
          </span>
        </span>
      }
    >
      <div className="space-y-3">
        <Tabla className="table-fixed">
          <TablaCabecera>
            <tr>
              <TH className="w-28">Día</TH>
              <TH>Actividad</TH>
              <TH className="hidden w-1/3 md:table-cell">Componente</TH>
              <TH className="hidden w-48 md:table-cell">Responsable</TH>
            </tr>
          </TablaCabecera>
          <tbody>
            {o.actividades.map((a) => (
              <TR key={a.id} data-actividad={a.tipo}>
                <TD className="tabular">
                  <Link
                    href={`/diseno/informe-semanal?semana=${a.fecha_inicio}`}
                    className="inline-flex min-h-11 items-center text-acento hover:underline sm:min-h-0"
                  >
                    {dia(a.fecha_inicio, a.fecha_entrega)}
                    <span className="sr-only">: abrir la semana del informe</span>
                  </Link>
                </TD>
                <TD>
                  {nombreTarea(a.tipo)}
                  {/* En el teléfono, lo que en el monitor tiene columna propia. */}
                  <span className="block text-xs text-texto-suave md:hidden">
                    {a.componente}
                    {a.integrante ? ` · ${a.integrante}` : ''}
                  </span>
                  {a.observacion && <span className="block text-xs text-texto-suave">{a.observacion}</span>}
                </TD>
                <TD className="hidden break-words md:table-cell">{a.componente}</TD>
                <TD className="hidden md:table-cell">{a.integrante ?? '—'}</TD>
              </TR>
            ))}
          </tbody>
        </Tabla>
        <Link href={`/ordenes/${o.orden_id}`} className="inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline">
          Ver la OT {o.numero}
        </Link>
      </div>
    </Pliegue>
  )
}

/**
 * El trabajo del colaborador de Diseño reunido por OT (Plan 7, entrega 7.2):
 * por cada OT de su equipo, lo que anotó en el informe semanal de todas las
 * semanas, con el día y el tipo. Solo para leer: se anota en el informe.
 * `ots` en `null` es «no se pudo leer», y se dice.
 *
 * Para que no empuje la lista de OT hacia abajo: a la vista, las cinco OT con
 * lo último que anotó; las demás con actividades, en «Ver las otras»; y las de
 * su equipo donde todavía no anotó nada, juntas en un solo pliegue.
 */
export function TrabajoPorOt({ ots, aviso }: { ots: TrabajoEnLaOt[] | null; aviso?: string }) {
  const conActividades = ots?.filter((o) => o.actividades.length > 0) ?? []
  const sinActividades = ots?.filter((o) => o.actividades.length === 0) ?? []
  const total = conActividades.reduce((s, o) => s + o.actividades.length, 0)
  const aLaVista = conActividades.slice(0, A_LA_VISTA)
  const otras = conActividades.slice(A_LA_VISTA)
  return (
    <Tarjeta data-trabajo-por-ot>
      <TarjetaCabecera
        titulo="Tu trabajo por OT"
        descripcion={
          ots && ots.length > 0
            ? `${total} ${total === 1 ? 'actividad que anotaste' : 'actividades que anotaste'} en ${conActividades.length} de ${ots.length} OT`
            : undefined
        }
        ayuda="Lo que anotaste con tu cuenta en el informe semanal, de todas las semanas, reunido por OT: primero la de lo último que hiciste. Lo que anotó otro colaborador no sale aquí, aunque te ponga de responsable. Solo para leer: las actividades se anotan en el informe semanal."
        acciones={
          <EnlaceBoton href="/diseno/informe-semanal" variante="contorno">
            Informe semanal
          </EnlaceBoton>
        }
      />
      <TarjetaCuerpo className="space-y-3">
        {ots === null ? (
          <p role="status" className="text-sm text-aviso">
            {aviso ?? 'No se pudo leer tu trabajo por OT. Recarga la página; si continúa, avisa al administrador.'}
          </p>
        ) : ots.length === 0 ? (
          <SinDatos
            compacto
            titulo="Todavía no hay OT con colaboradores de Diseño"
            descripcion="Diseño los agrega en la pestaña Planos de cada OT, en «Personas que elaboran los planos». Entonces la OT aparece aquí."
          />
        ) : (
          <>
            {conActividades.length === 0 && (
              <SinDatos
                compacto
                titulo="Todavía no anotaste actividades"
                descripcion="Cuando anotes una en el informe semanal, aparecerá aquí en su OT, con su día."
              />
            )}
            {aLaVista.map((o) => <OtConActividades key={o.orden_id} o={o} />)}
            {otras.length > 0 && (
              <Pliegue titulo={`Ver las otras ${otras.length} OT con actividades tuyas`} data-trabajo-otras="">
                <div className="space-y-3">{otras.map((o) => <OtConActividades key={o.orden_id} o={o} />)}</div>
              </Pliegue>
            )}
            {sinActividades.length > 0 && (
              <Pliegue
                titulo={`${sinActividades.length} OT de tu equipo sin actividades tuyas`}
                data-trabajo-sin-actividades=""
              >
                <ul className="divide-y divide-borde">
                  {sinActividades.map((o) => (
                    <li key={o.orden_id} data-trabajo-ot-vacia={o.numero}>
                      <Link href={`/ordenes/${o.orden_id}`} className="flex min-h-11 items-center py-2 text-sm text-acento hover:underline">
                        <Cabecera o={o} />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Pliegue>
            )}
          </>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * La tarjeta con sus datos, aparte de la lista: va dentro de su `<Suspense>`
 * para que la lista de OT no la espere en cada filtro o página. Si no se lee,
 * la tarjeta lo dice y la lista sigue.
 */
export async function TrabajoPorOtDeLaCuenta() {
  const leido = await trabajoDeDisenoPorOt().then(
    (ots) => ({ ots, aviso: undefined }),
    (e: unknown) => {
      console.error('Órdenes: no se pudo leer el trabajo por OT del colaborador.', e)
      const permiso = (e as { cause?: { code?: string } })?.cause?.code === '42501'
      return { ots: null, aviso: permiso && e instanceof Error ? e.message : undefined }
    },
  )
  return <TrabajoPorOt ots={leido.ots} aviso={leido.aviso} />
}

/** Mientras la base junta el trabajo: el mismo lugar, sin mover la lista después. */
export function TrabajoPorOtCargando() {
  return (
    <Tarjeta data-trabajo-por-ot-cargando>
      <TarjetaCabecera titulo="Tu trabajo por OT" />
      <TarjetaCuerpo>
        <p role="status" className="text-sm text-texto-suave">Juntando lo que anotaste en el informe semanal…</p>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
