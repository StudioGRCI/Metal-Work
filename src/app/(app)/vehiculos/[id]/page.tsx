import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarVehiculo, type FotoVehiculo } from '@/lib/datos/vehiculos'
import { MOTIVO_VEHICULO } from '@/lib/dominio/requerimientos'
import { fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { ControlesVehiculo } from '../controles'

export const metadata = { title: 'Vehículo en la planta' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Un ingreso a la planta con sus fotos: cómo entró el vehículo y cómo salió. */
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

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{nombre}</span>}
        descripcion={`${r.unidad} · ${r.empresa}`}
        migas={[{ titulo: 'Vehículos', ruta: '/vehiculos' }, { titulo: nombre }]}
        acciones={
          registra && !r.salida_en && !anulado && <ControlesVehiculo id={r.id} nombre={nombre} cuentaId={perfil.id} />
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
                <Insignia tono="neutro">Salió</Insignia>
              ) : (
                <Insignia tono="aviso">En planta</Insignia>
              )}
            </Dato>
            {r.placa && r.chasis && <Dato titulo="Chasis">{r.chasis}</Dato>}
            {r.codigo_interno && (r.placa || r.chasis) && <Dato titulo="Código interno">{r.codigo_interno}</Dato>}
            {r.motivo_anulacion && (
              <p className="basis-full text-sm text-peligro">Anulado: {r.motivo_anulacion}. Sus fotos quedan como evidencia.</p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

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
