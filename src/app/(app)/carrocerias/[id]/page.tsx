import { notFound } from 'next/navigation'
import type { Metadata } from 'next'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { plantillaEntera } from '@/lib/datos/carrocerias'
import { cantidad } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

const TIPO_UNIDAD: Record<string, string> = {
  SEMIRREMOLQUE: 'Semirremolque',
  CARROCERIA_MONTADA: 'Carrocería montada',
}

export async function generateMetadata({ params }: PageProps<'/carrocerias/[id]'>): Promise<Metadata> {
  const { id } = await params
  const plantilla = await plantillaEntera(id)
  return { title: plantilla ? plantilla.nombre : 'Ficha no encontrada' }
}

/**
 * Una ficha técnica preescrita, tal como bajará a la cotización: la cabecera,
 * las secciones con sus líneas, los accesorios y los pasos de verificación
 * que el taller recorrerá con esa carrocería.
 */
export default async function PaginaPlantilla({ params }: PageProps<'/carrocerias/[id]'>) {
  await exigirPermiso(['cotizaciones.costear', 'cotizaciones.ver', 'configuracion.ver'])
  const { id } = await params

  const plantilla = await plantillaEntera(id)
  if (!plantilla) notFound()

  const tipoUnidad = plantilla.tipo_unidad ?? plantilla.tipo?.tipo_unidad ?? null
  const capacidad = plantilla.capacidad_habitual ?? plantilla.tipo?.capacidad ?? null

  return (
    <>
      <EncabezadoPagina
        migas={[{ titulo: 'Carrocerías', ruta: '/carrocerias' }, { titulo: plantilla.nombre }]}
        titulo={
          <span className="flex flex-wrap items-center gap-3">
            {plantilla.nombre}
            {plantilla.predeterminada && <Insignia tono="acento">Predeterminada</Insignia>}
            {!plantilla.activa && <Insignia tono="neutro">Dada de baja</Insignia>}
          </span>
        }
        descripcion={plantilla.descripcion ?? undefined}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta>
          <TarjetaCabecera titulo="Carrocería" />
          <TarjetaCuerpo className="space-y-0">
            <Dato etiqueta="Catálogo" valor={plantilla.tipo ? `${plantilla.tipo.nombre} (${plantilla.tipo.codigo})` : null} />
            <Dato etiqueta="Tipo" valor={tipoUnidad ? TIPO_UNIDAD[tipoUnidad] ?? tipoUnidad : null} />
            <Dato etiqueta="Capacidad habitual" valor={capacidad} />
            <Dato etiqueta="Transcrita de" valor={plantilla.fuentes.length ? plantilla.fuentes.join(', ') : null} />
            <Dato etiqueta="Líneas" valor={plantilla.secciones.reduce((n, s) => n + s.lineas.length, 0)} />
            <Dato etiqueta="Accesorios" valor={plantilla.accesorios.length} />
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Equipamiento"
            descripcion="Lo que la casa promete con esta carrocería. «Sin el accesorio» es el porta que se entrega vacío."
          />
          <TarjetaCuerpo className="p-0">
            {plantilla.accesorios.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-texto-suave">Esta ficha no lista accesorios.</p>
            ) : (
              <ul className="divide-y divide-borde">
                {plantilla.accesorios.map((a) => (
                  <li key={a.orden} className="flex items-center gap-3 px-4 py-2 text-sm">
                    <span className="tabular w-16 shrink-0 text-right text-texto-suave">
                      {cantidad(a.cantidad)} {a.unidad}
                    </span>
                    <span className="flex-1 text-texto">{a.descripcion}</span>
                    {!a.incluye_el_accesorio && <Insignia tono="aviso">Sin el accesorio</Insignia>}
                  </li>
                ))}
              </ul>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Ficha técnica"
            descripcion="Sección por sección, en el orden en que la escribe la empresa. Las medidas y la capacidad no van acá: se llenan en cada cotización."
          />
          <TarjetaCuerpo className="space-y-5">
            {plantilla.secciones.length === 0 ? (
              <p className="py-4 text-center text-sm text-texto-suave">Esta ficha no tiene líneas.</p>
            ) : (
              plantilla.secciones.map((s) => (
                <section key={s.seccion}>
                  <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-texto-suave uppercase">
                    {s.seccion}
                  </h3>
                  <ul className="space-y-1 text-sm">
                    {s.lineas.map((l) => (
                      <li key={`${l.orden_seccion}-${l.orden_linea}`} className="flex gap-2">
                        <span aria-hidden className="text-texto-tenue">–</span>
                        <span className="text-texto">
                          {l.etiqueta && <span className="font-medium">{l.etiqueta}: </span>}
                          {l.detalle}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Tarjeta>
          <TarjetaCabecera
            titulo="Verificación y funcionamiento"
            descripcion="Los pasos que el taller recorre con esta carrocería; bajan a la OT al aprobarla."
          />
          <TarjetaCuerpo className="p-0">
            {plantilla.verificacion.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-texto-suave">
                Sin lista propia: la OT usa la genérica.
              </p>
            ) : (
              <ol className="divide-y divide-borde">
                {plantilla.verificacion.map((v) => (
                  <li key={v.numero} className="flex gap-3 px-4 py-2 text-sm">
                    <span className="tabular w-6 shrink-0 text-right text-texto-suave">{v.numero}</span>
                    <span className="text-texto">{v.descripcion}</span>
                  </li>
                ))}
              </ol>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      </div>
    </>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor?: string | number | null }) {
  return (
    <div className="flex justify-between gap-4 border-b border-borde py-2 text-sm last:border-0">
      <span className="text-texto-suave">{etiqueta}</span>
      <span className="text-right font-medium text-texto">{valor ?? '—'}</span>
    </div>
  )
}
