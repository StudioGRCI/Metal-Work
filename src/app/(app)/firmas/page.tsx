import { Clock, FileText, PenLine } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { misFirmasPendientes } from '@/lib/datos/firmas'
import { nombreDeUnidad, todaviaSinPlaca } from '@/lib/dominio/unidades'
import { fecha as formatearFecha, fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { BotonFirmar } from './boton-firmar'

export const metadata = { title: 'Firmas pendientes' }

export default async function PaginaFirmas() {
  const perfil = await exigirSesion()
  const firmas = await misFirmasPendientes()

  const meToca = firmas.filter((f) => f.le_toca)
  const enEspera = firmas.filter((f) => !f.le_toca)

  // El botón del vacío solo se pinta a quien puede entrar al repositorio: un
  // enlace que termina en «no tienes permiso» es peor que ningún enlace.
  const veDocumentos = puede(perfil, 'documentos.ver')

  return (
    <>
      <EncabezadoPagina
        titulo="Firmas pendientes"
        descripcion="Los documentos que esperan tu decisión. Se firma en cadena: si alguien va antes que tú, primero tiene que decidir."
      />

      {firmas.length === 0 ? (
        <Tarjeta>
          <TarjetaCuerpo>
            <p className="text-sm font-medium text-texto">No tienes nada por firmar</p>
            <p className="mt-1 text-sm text-texto-suave">
              Cuando alguien te pida la firma de un plano, un acta o una cotización, aparecerá acá.
            </p>
            {veDocumentos && (
              <EnlaceBoton href="/documentos" variante="secundario" className="mt-4">
                <FileText aria-hidden className="size-4" />
                Ver los documentos del taller
              </EnlaceBoton>
            )}
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="space-y-6">
          {meToca.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-texto">
                Te toca firmar ({meToca.length})
              </h2>
              <div className="space-y-3">
                {meToca.map((f) => (
                  <Fila key={f.aprobacion_id} firma={f} activa />
                ))}
              </div>
            </section>
          )}

          {enEspera.length > 0 && (
            <section>
              <h2 className="mb-2 text-sm font-semibold text-texto">
                Esperando una firma anterior ({enEspera.length})
              </h2>
              <div className="space-y-3">
                {enEspera.map((f) => (
                  <Fila key={f.aprobacion_id} firma={f} />
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  )
}

function Fila({
  firma,
  activa = false,
}: {
  firma: Awaited<ReturnType<typeof misFirmasPendientes>>[number]
  activa?: boolean
}) {
  // La unidad se nombra en un solo sitio. Un documento sin orden no tiene
  // unidad que nombrar —eso sí se puede decir, y por eso va en null—; con
  // orden, el nombre lo pone `nombreDeUnidad` con lo que trae la bandeja.
  const unidad = firma.orden_id ? { placa: firma.placa } : null

  return (
    <Tarjeta>
      <TarjetaCuerpo className="flex flex-wrap items-center gap-4">
        {/* El icono se esconde en el teléfono: no dice nada que el texto no diga
            y ahí cada píxel de ancho es del título. */}
        <FileText aria-hidden className="hidden size-5 shrink-0 text-texto-tenue sm:block" />

        <div className="min-w-48 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
            {firma.titulo}
            <Insignia tono="neutro">{firma.tipo_nombre}</Insignia>
            {firma.version_actual > 1 && (
              <span className="text-[11px] text-texto-suave">v{firma.version_actual}</span>
            )}
            {firma.firmas_total > 1 && (
              <span className="text-[11px] text-texto-suave">
                firma {firma.orden_firma} de {firma.firmas_total}
              </span>
            )}
          </p>

          <p className="text-[11px] text-texto-suave">
            {firma.orden_numero && (
              <>
                {/* Alto de dedo en el teléfono: es el único enlace de la fila y
                    cae pegado a los demás datos. */}
                <Link
                  href={`/ordenes/${firma.orden_id}?vista=documentos`}
                  className="inline-flex min-h-8 items-center text-acento hover:underline sm:min-h-0"
                >
                  {firma.orden_numero}
                </Link>
                {' · '}
              </>
            )}
            {/* Sin placa el nombre lo pone el código de fábrica o el chasis: va
                más tenue para que nadie lo lea de lejos como una matrícula. */}
            <span className={todaviaSinPlaca(unidad) ? 'text-texto-tenue' : undefined}>
              {nombreDeUnidad(unidad)}
            </span>
            {firma.fecha_documento && ` · ${formatearFecha(firma.fecha_documento)}`}
          </p>

          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-texto-tenue">
            <Clock aria-hidden className="size-3" />
            Lo pidió {firma.solicitado_por_nombre ?? 'alguien'} el{' '}
            {fechaHora(firma.solicitado_en)}
          </p>
        </div>

        {activa ? (
          <BotonFirmar aprobacionId={firma.aprobacion_id} titulo={firma.titulo} />
        ) : (
          <span className="inline-flex w-full items-center gap-1.5 text-[11px] text-texto-tenue sm:w-auto">
            <PenLine aria-hidden className="size-3.5" />
            falta la firma anterior
          </span>
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
