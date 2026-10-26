import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  cargarFichaDeVehiculo,
  cargarVehiculo,
  estadosDeSalida,
  puntosDeFicha,
  revisionesDeSalida,
  type EstadoDeSalida,
  type FichaDeVehiculo,
  type FotoVehiculo,
  type RevisionDeSalida,
} from '@/lib/datos/vehiculos'
import { definirRevisionSalida } from '@/lib/dominio/ficha-vehiculo'
import { MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ControlesVehiculo } from '../controles'
import { AdjuntarEscaneo, DescargarFicha, FichaDelVehiculo, PedirRevision } from './ficha'

export const metadata = { title: 'Vehículo en la planta' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Un ingreso a la planta: la ficha única de ingreso y salida, la revisión de
 * Tesorería para que salga y las fotos de cómo entró y cómo salió. La ficha y
 * la revisión vivían en la OT; desde el 2026-10-15 van aquí, con el código
 * interno del vehículo (migración 20261016110000).
 */
export default async function PaginaVehiculo({ params }: PageProps<'/vehiculos/[id]'>) {
  const perfil = await exigirPermiso(['vehiculos.registrar', 'vehiculos.ver'])
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const r = await cargarVehiculo(id)
  if (!r) notFound()

  const nombre = r.placa ?? (r.chasis ? `Chasis ${r.chasis}` : (r.codigo_interno ?? 'Vehículo'))
  const motivo = MOTIVO_VEHICULO[r.motivo]
  const anulado = r.anulado_en !== null
  const registra = puede(perfil, 'vehiculos.registrar')
  const alEntrar = r.fotos.filter((f) => f.momento === 'INGRESO')
  const alSalir = r.fotos.filter((f) => f.momento === 'SALIDA')
  const enPlanta = !r.salida_en && !anulado
  const [{ ficha, escaneo }, puntos, revisiones, estados] = await Promise.all([
    cargarFichaDeVehiculo(r.id),
    puntosDeFicha(),
    revisionesDeSalida(r.id),
    estadosDeSalida(enPlanta ? [r.id] : []),
  ])
  const estado = estados.get(r.id)

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{nombre}</span>}
        descripcion={`${r.unidad} · ${r.empresa}`}
        migas={[{ titulo: 'Vehículos', ruta: '/vehiculos' }, { titulo: nombre }]}
        acciones={
          registra &&
          enPlanta && (
            <ControlesVehiculo
              id={r.id}
              nombre={nombre}
              cuentaId={perfil.id}
              bloqueoSalida={estado?.falta_para_salir ?? null}
              alArenado={Boolean(estado?.exige)}
            />
          )
        }
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
            <Dato titulo="Motivo">{motivo ? <Insignia tono={motivo.tono}>{motivo.etiqueta}</Insignia> : r.motivo}</Dato>
            <Dato titulo="Situación">
              {anulado ? (
                <Insignia tono="peligro">Anulado</Insignia>
              ) : r.salida_en ? (
                <Insignia tono="neutro">{r.sale_al_arenado ? 'Salió al arenado' : 'Salió'}</Insignia>
              ) : (
                <Insignia tono="aviso">En planta</Insignia>
              )}
            </Dato>
            {r.placa && r.chasis && <Dato titulo="Chasis">{r.chasis}</Dato>}
            {r.codigo_interno && (r.placa || r.chasis) && <Dato titulo="Código interno">{r.codigo_interno}</Dato>}
            {estado?.exige && estado.garantia_ot && (
              <Dato titulo="OT de garantía">
                <span data-garantia-salida={estado.garantia_estado ?? ''}>
                  {estado.garantia_ot} ·{' '}
                  {estado.garantia_estado === 'TERMINADA'
                    ? 'garantía terminada'
                    : estado.garantia_estado === 'ANULADA' ? 'OT anulada' : 'garantía por terminar'}
                </span>
              </Dato>
            )}
            {estado?.exige && !estado.garantia_ot && (
              <Dato titulo="Avance del código">
                <span data-avance-salida={estado.avance ?? 0}>{estado.avance ?? 0} %</span>
              </Dato>
            )}
            {estado?.exige && estado.falta_para_salir && (
              <p id={`veh-bloqueo-${r.id}`} className="basis-full text-sm text-texto-suave" data-bloqueo-salida>
                {estado.falta_para_salir}
              </p>
            )}
            {r.motivo_anulacion && (
              <p className="basis-full text-sm text-peligro">Anulado: {r.motivo_anulacion}. Sus fotos quedan como evidencia.</p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta id="ficha">
          <TarjetaCabecera
            titulo="Ficha de ingreso y salida"
            ayuda="El formato de inspección vehicular de Metal Work (SIG-FCLIV-001). Se llena al entrar, se completa al salir y se adjunta firmado."
            acciones={
              <span className="flex flex-wrap gap-2">
                <DescargarFicha registro={r.id} />
                {escaneo && (
                  <a href={escaneo} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-sm text-acento hover:underline sm:min-h-0">
                    Ver escaneo firmado
                  </a>
                )}
              </span>
            }
          />
          <TarjetaCuerpo className="space-y-4">
            {!ficha && r.salida_en ? (
              <p className="text-sm text-texto-suave">El vehículo salió de la planta sin que se llenara su ficha.</p>
            ) : !ficha && !registra ? (
              <p className="text-sm text-texto-suave">Requerimientos todavía no llenó la ficha de este ingreso.</p>
            ) : (
              <FichaDelVehiculo
                registro={r.id}
                ficha={ficha}
                puntos={puntos}
                editable={registra && !anulado && !r.salida_en}
                salio={Boolean(r.salida_en)}
              />
            )}
            {registra && !anulado && ficha?.salida_cerrada_en && !ficha.escaneo_ruta && <AdjuntarEscaneo registro={r.id} />}
          </TarjetaCuerpo>
        </Tarjeta>

        <RevisionDeTesoreria
          registro={r.id}
          ficha={ficha}
          revisiones={revisiones}
          puedePedir={registra && enPlanta}
          salio={Boolean(r.salida_en)}
          alArenado={r.sale_al_arenado}
          estado={estado}
        />

        <Momento
          titulo="Al entrar"
          cuando={r.ingreso_en}
          observacion={r.observacion_ingreso}
          fotos={alEntrar}
          sinFotos="Entró antes de que el ingreso llevara fotos."
        />
        {r.salida_en ? (
          <Momento
            titulo="Al salir"
            cuando={r.salida_en}
            observacion={r.observacion_salida}
            fotos={alSalir}
            sinFotos="Salió antes de que la salida llevara fotos."
          />
        ) : (
          !anulado && (
            <Tarjeta>
              <TarjetaCabecera titulo="Al salir" />
              <TarjetaCuerpo>
                <p className="text-sm text-texto-suave">Sigue en la planta. Al marcar su salida se le toman las fotos de cómo sale.</p>
              </TarjetaCuerpo>
            </Tarjeta>
          )
        )}
      </div>
    </>
  )
}

function Dato({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-texto-suave">{titulo}</p>
      <div className="tabular text-texto">{children}</div>
    </div>
  )
}

function Momento({
  titulo,
  cuando,
  observacion,
  fotos,
  sinFotos,
}: {
  titulo: string
  cuando: string
  observacion: string | null
  fotos: FotoVehiculo[]
  sinFotos: string
}) {
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={`${titulo}${fotos.length > 0 ? ` · ${fotos.length} ${fotos.length === 1 ? 'foto' : 'fotos'}` : ''}`}
        descripcion={fechaHora(cuando)}
      />
      <TarjetaCuerpo className="space-y-3">
        {observacion && <p className="text-sm text-texto">{observacion}</p>}
        {fotos.length === 0 ? (
          <p className="text-sm text-texto-suave">{sinFotos}</p>
        ) : (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {fotos.map((f) => (
              <li key={f.id}>
                {f.enlace ? (
                  <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
                    {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
                    <img src={f.enlace} alt={`Foto ${f.orden} ${titulo.toLowerCase()}`} className="aspect-square w-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
                    La foto {f.orden} no se pudo abrir ahora
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/**
 * El pedido a Tesorería para que el vehículo salga: se pide con la ficha de
 * salida cerrada y su escaneo firmado, y Tesorería lo da por revisado o lo
 * observa. Si lo observa, se vuelve a pedir; cada pedido queda en el historial.
 */
function RevisionDeTesoreria({
  registro,
  ficha,
  revisiones,
  puedePedir,
  salio,
  alArenado,
  estado,
}: {
  registro: string
  ficha: FichaDeVehiculo | null
  revisiones: RevisionDeSalida[]
  puedePedir: boolean
  salio: boolean
  alArenado: boolean
  estado: EstadoDeSalida | undefined
}) {
  const ultima = revisiones[0]
  const esperando = ultima?.estado === 'PENDIENTE'
  const revisada = ultima?.estado === 'ATENDIDA'
  const lista = Boolean(ficha?.salida_cerrada_en && ficha.escaneo_ruta)
  return (
    <Tarjeta id="revision-salida">
      <TarjetaCabecera
        titulo="Revisión de Tesorería para la salida"
        ayuda="Antes de entregar el vehículo, Tesorería revisa lo que le pidas (por ejemplo, si el cliente pagó). Se pide con la ficha de salida cerrada y su escaneo firmado."
        acciones={ultima && <Insignia tono={definirRevisionSalida(ultima.estado).tono}>{definirRevisionSalida(ultima.estado).etiqueta}</Insignia>}
      />
      <TarjetaCuerpo className="space-y-4">
        {puedePedir && esperando && (
          <p className="text-sm text-texto">Pedido enviado: Tesorería tiene el aviso. Su respuesta te llega como aviso y queda aquí abajo.</p>
        )}
        {puedePedir && revisada && !estado?.falta_para_salir && (
          <p className="text-sm text-texto">Tesorería la dio por revisada: ya puedes marcar la salida del vehículo.</p>
        )}
        {puedePedir && !esperando && !revisada && (estado?.falta_para_pedir ? (
          // El porqué ya está arriba, junto al avance: aquí no se repite.
          <p className="text-sm text-texto-suave">
            {estado.garantia_ot
              ? 'Se pide cuando Administración dé por terminada la garantía.'
              : 'Se pide cuando el código llegue al 100 % del avance.'}
          </p>
        ) : lista ? (
          <PedirRevision registro={registro} solicitud={crypto.randomUUID()} />
        ) : (
          <p className="text-sm text-texto-suave">
            Para pedirla, cierra la salida de la ficha y adjunta su escaneo firmado (arriba, en la ficha).
          </p>
        ))}
        {!puedePedir && !salio && revisiones.length === 0 && (
          <p className="text-sm text-texto-suave">Requerimientos todavía no pidió la revisión.</p>
        )}
        {revisiones.length > 0 ? (
          <ol className="space-y-2">
            {revisiones.map((v) => {
              const estado = definirRevisionSalida(v.estado)
              return (
                <li key={v.id} className="rounded-[var(--radius-base)] border border-borde p-3 text-sm" data-estado={v.estado}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-texto-suave">
                      {fechaHora(v.creado_en)}
                      {v.solicitante && ` · ${v.solicitante}`}
                    </span>
                    <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap text-texto">{v.concepto}</p>
                  {v.respuesta && (
                    <p className="mt-2 rounded-[var(--radius-base)] bg-superficie-2 p-2 text-texto">
                      Tesorería{v.atendio ? ` (${v.atendio})` : ''}
                      {v.atendido_en ? `, ${fechaHora(v.atendido_en)}` : ''}: {v.respuesta}
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        ) : (
          salio && (
            <p className="text-sm text-texto-suave">
              {alArenado ? 'Salió al arenado: esa salida no pide revisión a Tesorería.' : 'Salió sin pedido de revisión a Tesorería.'}
            </p>
          )
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
