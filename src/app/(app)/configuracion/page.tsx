import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { calendarioLaboral, catalogosDelTaller } from '@/lib/datos/configuracion'
import { cantidad } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { DiasLaborables, Feriados } from './calendario'

export const metadata = { title: 'Configuración' }

export default async function PaginaConfiguracion({
  searchParams,
}: PageProps<'/configuracion'>) {
  const perfil = await exigirPermiso('configuracion.ver')
  const query = await searchParams

  const hoy = new Date().getFullYear()
  const anio = Number(typeof query.anio === 'string' ? query.anio : hoy) || hoy

  const [calendario, catalogos] = await Promise.all([
    calendarioLaboral(anio),
    catalogosDelTaller(),
  ])
  const puedeEditar = puede(perfil, 'configuracion.editar')

  return (
    <>
      <EncabezadoPagina
        titulo="Configuración"
        descripcion="El calendario del taller y los catálogos con los que trabaja el sistema."
        acciones={
          <form method="get" className="flex items-center gap-2">
            <label htmlFor="anio" className="text-xs text-texto-suave">
              Año
            </label>
            <input
              id="anio"
              type="number"
              name="anio"
              defaultValue={anio}
              min={2020}
              max={2100}
              className="w-24 rounded-[var(--radius-base)] border border-borde bg-superficie px-2 py-1 text-sm text-texto"
            />
            <button type="submit" className="text-sm text-acento hover:underline">
              Ver
            </button>
          </form>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <DiasLaborables dias={calendario.diasLaborables} puedeEditar={puedeEditar} />
          <Feriados anio={anio} feriados={calendario.feriados} puedeEditar={puedeEditar} />
        </div>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera
              titulo="Tipos de carrocería"
              descripcion="Lo que el taller fabrica. Cada uno arrastra su ficha y sus pasos de verificación."
            />
            <TarjetaCuerpo className="space-y-1">
              {catalogos.carrocerias.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-3 border-b border-borde py-1.5 text-sm last:border-0">
                  <span className="text-texto">
                    {c.nombre}
                    {!c.activo && <span className="ml-2 text-[11px] text-texto-tenue">(inactivo)</span>}
                  </span>
                  <span className="tabular text-xs text-texto-suave">
                    {cantidad(c.horas_hombre_estandar)} h estándar
                  </span>
                </div>
              ))}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera
              titulo="Etapas de fabricación"
              descripcion="En este orden avanza cada orden. Las marcadas exigen inspección de calidad."
            />
            <TarjetaCuerpo className="space-y-1">
              {catalogos.etapas.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 border-b border-borde py-1.5 text-sm last:border-0">
                  <span className="text-texto">
                    <span className="tabular mr-2 text-xs text-texto-tenue">{e.orden_secuencia}</span>
                    {e.nombre}
                  </span>
                  <span className="flex items-center gap-2">
                    {e.requiere_inspeccion && <Insignia tono="aviso">calidad</Insignia>}
                    <span className="tabular text-xs text-texto-suave">{cantidad(e.horas_estandar)} h</span>
                  </span>
                </div>
              ))}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera
              titulo="Fichas y verificaciones"
              descripcion="Las plantillas que se aplican al cotizar y al aprobar una orden."
            />
            <TarjetaCuerpo className="space-y-3">
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                  Fichas técnicas preescritas
                </p>
                {catalogos.fichas.length === 0 ? (
                  <p className="text-sm text-texto-suave">Todavía no hay fichas.</p>
                ) : (
                  catalogos.fichas.map((f) => (
                    <p key={f.id} className="text-sm text-texto">
                      {f.nombre}
                      {f.carroceria && <span className="text-texto-suave"> · {f.carroceria}</span>}
                    </p>
                  ))
                )}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                  Pasos de verificación por carrocería
                </p>
                {catalogos.verificaciones.map((v) => (
                  <p key={v.nombre} className="text-sm text-texto">
                    {v.nombre} <span className="tabular text-texto-suave">· {v.pasos} pasos</span>
                  </p>
                ))}
              </div>
              <p className="text-xs text-texto-tenue">
                Estas listas se editan con administración; cambiarlas cambia lo que el taller firma.
              </p>
            </TarjetaCuerpo>
          </Tarjeta>
        </div>
      </div>
    </>
  )
}
