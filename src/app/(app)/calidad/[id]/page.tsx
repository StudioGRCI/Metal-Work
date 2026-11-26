import { notFound } from 'next/navigation'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia, type Tono } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarInspeccion, type DetalleInspeccion, type FotoCalidad } from '@/lib/datos/calidad'
import { diasAbierta, ESTADO_INSPECCION, PASO_CALIDAD, RESULTADO_INSPECCION, type TipoPasoCalidad } from '@/lib/dominio/calidad'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { AnularInspeccion, EstadoDelPaso, PasosDeLaObservacion } from './controles'

export const metadata = { title: 'Inspección de calidad' }

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Una inspección de calidad: qué se revisó, qué se observó, su recorrido y sus
 * fotos. Calidad y Gerencia la ven siempre; el área, mientras no esté anulada.
 * Qué botón le toca a quien mira lo dice la base.
 */
export default async function PaginaInspeccion({ params }: PageProps<'/calidad/[id]'>) {
  const perfil = await exigirSesion()
  const { id } = await params
  if (!GUID.test(id)) notFound()
  const r = await cargarInspeccion(id)
  if (!r) notFound()

  const estado = ESTADO_INSPECCION[r.estado]
  const resultado = RESULTADO_INSPECCION[r.resultado]
  const anulada = r.estado === 'ANULADA'
  // El mismo permiso que pide `calidad_anular_inspeccion`.
  const anula = puede(perfil, 'calidad.inspeccionar') && !anulada
  const tipos: TipoPasoCalidad[] = [
    ...(r.puede_corregir ? (['CORREGIDA'] as const) : []),
    ...(r.puede_revisar ? (['LEVANTADA'] as const) : []),
    ...(r.puede_revisar && r.estado === 'CORREGIDA' ? (['OBSERVADA_DE_NUEVO'] as const) : []),
  ]
  const queSeReviso = r.etapa ? `${r.etapa} · ${r.area}` : r.area

  return (
    <>
      <EncabezadoPagina
        titulo={<span className="tabular">{r.codigo_interno}</span>}
        descripcion={queSeReviso}
        migas={[{ titulo: 'Calidad', ruta: '/calidad' }, { titulo: r.codigo_interno }]}
        acciones={anula && <AnularInspeccion id={r.id} codigo={r.codigo_interno} />}
        estado={<EstadoDelPaso />}
      />

      <div className="space-y-5">
        <Tarjeta>
          <TarjetaCuerpo className="space-y-4">
            <div className="flex flex-wrap items-start gap-x-8 gap-y-3 text-sm">
              <Dato titulo="Resultado">{resultado ? <Insignia tono={resultado.tono}>{resultado.etiqueta}</Insignia> : r.resultado}</Dato>
              <Dato titulo="Cómo va">
                <span className="flex flex-wrap items-center gap-1.5">
                  {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : r.estado}
                  {diasAbierta(r.dias_abierta) && <span className="text-xs text-texto-suave">desde {diasAbierta(r.dias_abierta)}</span>}
                </span>
              </Dato>
              <Dato titulo="Etapa">{r.etapa ?? 'Sin etapa: se eligió el área'}</Dato>
              <Dato titulo="Área">{r.area}</Dato>
              <Dato titulo="Revisada">{fechaHora(r.creado_en)}</Dato>
            </div>
            {r.observacion && (
              <div>
                <p className="text-xs text-texto-suave">{r.resultado === 'NO_CONFORME' ? 'Qué está no conforme' : 'Observación'}</p>
                <p className="mt-1 max-w-3xl text-sm whitespace-pre-wrap text-texto">{r.observacion}</p>
              </div>
            )}
            {tipos.length > 0 && (
              <div className="border-t border-borde pt-4">
                <p className="mb-2 text-sm text-texto-suave">
                  {r.puede_corregir
                    ? 'Cuando lo corrijas, márcalo aquí con una nota o una foto: le llega a Calidad.'
                    : r.estado === 'CORREGIDA'
                      ? 'El área dice que lo corrigió: revísalo y levántalo, o vuelve a observarlo.'
                      : 'Si ya está corregido, puedes levantarla sin esperar al área.'}
                </p>
                <PasosDeLaObservacion inspeccionId={r.id} cuentaId={perfil.id} tipos={tipos} />
              </div>
            )}
            {r.alcance === 'AREA' && !r.puede_corregir && (
              <p className="text-xs text-texto-suave" data-alcance-area>
                La ves porque es de tu área.
              </p>
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <Fotos titulo="Fotos de la inspección" fotos={r.fotosDeLaInspeccion} vacio="Se registró sin fotos." codigo={r.codigo_interno} />

        <Recorrido inspeccion={r} />
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

function Fotos({ titulo, fotos, vacio, codigo }: { titulo: string; fotos: FotoCalidad[]; vacio: string; codigo: string }) {
  return (
    <Tarjeta>
      <TarjetaCabecera titulo={`${titulo}${fotos.length > 0 ? ` · ${fotos.length}` : ''}`} />
      <TarjetaCuerpo>
        {fotos.length === 0 ? <p className="text-sm text-texto-suave">{vacio}</p> : <ListaDeFotos fotos={fotos} codigo={codigo} />}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

function ListaDeFotos({ fotos, codigo, chicas = false }: { fotos: FotoCalidad[]; codigo: string; chicas?: boolean }) {
  return (
    <ul className={cn('grid gap-2', chicas ? 'mt-2 max-w-md grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4')}>
      {fotos.map((f) => (
        <li key={f.id}>
          {f.enlace ? (
            <a href={f.enlace} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-borde">
              {/* eslint-disable-next-line @next/next/no-img-element -- enlace firmado de Storage, no pasa por el optimizador */}
              <img src={f.enlace} alt={`Foto ${f.orden} de ${codigo}`} className="aspect-square w-full object-cover" loading="lazy" />
            </a>
          ) : (
            <p className="flex aspect-square items-center justify-center rounded-lg border border-borde p-2 text-center text-xs text-texto-suave">
              La foto {f.orden} no se pudo abrir ahora
            </p>
          )}
        </li>
      ))}
    </ul>
  )
}

const PUNTO: Partial<Record<Tono, string>> = {
  exito: 'bg-exito',
  aviso: 'bg-aviso',
  peligro: 'bg-peligro',
  neutro: 'bg-texto-tenue',
}

type Paso = {
  clave: string
  titulo: string
  quien: string | null
  cuando: string | null
  detalle: string | null
  fotos: FotoCalidad[]
  tono: Tono
  actual?: boolean
}

/** El recorrido: la inspección, cada paso de la observación y quién la tiene ahora. */
function pasosDe(r: DetalleInspeccion): Paso[] {
  const pasos: Paso[] = [
    {
      clave: 'inspeccionada',
      titulo: r.resultado === 'CONFORME' ? 'Revisada: conforme' : 'Revisada: no conforme',
      quien: r.registro_puesto,
      cuando: r.creado_en,
      detalle: null,
      fotos: [],
      tono: r.resultado === 'CONFORME' ? 'exito' : 'peligro',
    },
    ...r.recorrido.map((p) => ({
      clave: p.id,
      titulo: PASO_CALIDAD[p.tipo]?.etiqueta ?? p.tipo,
      quien: p.puesto,
      cuando: p.creado_en,
      detalle: p.nota,
      fotos: p.fotos,
      tono: PASO_CALIDAD[p.tipo]?.tono ?? 'neutro',
    })),
  ]
  if (r.estado === 'ANULADA') {
    pasos.push({
      clave: 'anulada',
      titulo: 'Anulada por Calidad',
      quien: r.anulo_puesto,
      cuando: r.anulado_en,
      detalle: r.motivo_anulacion,
      fotos: [],
      tono: 'neutro',
    })
  } else if (r.estado === 'OBSERVADA' || r.estado === 'CORREGIDA') {
    pasos.push({
      clave: 'ahora',
      titulo: r.estado === 'OBSERVADA' ? `La tiene ${r.area}` : 'La tiene Calidad',
      quien: null,
      cuando: null,
      detalle: r.estado === 'OBSERVADA' ? 'Espera que el área la corrija y la marque corregida.' : 'Espera que Calidad revise la corrección.',
      fotos: [],
      tono: 'aviso',
      actual: true,
    })
  }
  return pasos
}

function Recorrido({ inspeccion }: { inspeccion: DetalleInspeccion }) {
  const pasos = pasosDe(inspeccion)
  return (
    <Tarjeta>
      <TarjetaCabecera titulo="Recorrido" ayuda="Por dónde va la observación: quién la tiene ahora y cada paso, con su nota y sus fotos." />
      <TarjetaCuerpo>
        <ol className="space-y-0" data-recorrido>
          {pasos.map((p, i) => (
            <li key={p.clave} className="relative flex gap-3 pb-4 last:pb-0" aria-current={p.actual ? 'step' : undefined}>
              {i < pasos.length - 1 && <span aria-hidden className="absolute top-5 bottom-0 left-[5px] w-px bg-borde" />}
              <span aria-hidden className={cn('mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-[var(--superficie)]', PUNTO[p.tono] ?? 'bg-acento')} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-texto">
                  {p.titulo}
                  {p.quien && <span className="font-normal text-texto-suave"> · {p.quien}</span>}
                </p>
                {p.cuando && (
                  <time dateTime={p.cuando} className="tabular block text-xs text-texto-suave">
                    {fechaHora(p.cuando)}
                  </time>
                )}
                {p.detalle && <p className="mt-0.5 max-w-2xl text-sm whitespace-pre-wrap text-texto-suave">{p.detalle}</p>}
                {p.fotos.length > 0 && <ListaDeFotos fotos={p.fotos} codigo={inspeccion.codigo_interno} chicas />}
              </div>
            </li>
          ))}
        </ol>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
