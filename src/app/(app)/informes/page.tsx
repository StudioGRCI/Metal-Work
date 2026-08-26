import { ArrowRight, BarChart3 } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  comoFecha,
  informesVisibles,
  periodoPorDefecto,
  resumenDelPeriodo,
} from '@/lib/datos/informes'
import { cantidad, moneda, porcentaje } from '@/lib/format'
import { exigirPermiso } from '@/lib/sesion'

import { RangoDeFechas } from './rango-de-fechas'

export const metadata = { title: 'Informes' }

export default async function PaginaInformes({ searchParams }: PageProps<'/informes'>) {
  const perfil = await exigirPermiso('reportes.ver')
  const params = await searchParams

  const defecto = periodoPorDefecto()
  const desde = comoFecha(params.desde, defecto.desde)
  const hasta = comoFecha(params.hasta, defecto.hasta)

  const [resumen, informes] = await Promise.all([
    resumenDelPeriodo(desde, hasta),
    Promise.resolve(informesVisibles(perfil)),
  ])

  const puntualidad =
    resumen && resumen.ordenes_entregadas > 0
      ? (100 * resumen.entregas_a_tiempo) / resumen.ordenes_entregadas
      : null

  return (
    <>
      <EncabezadoPagina
        titulo="Informes"
        descripcion="Las preguntas del mes: si el taller gana o pierde, si entrega cuando promete y en qué se va el material."
      />

      <RangoDeFechas ruta="/informes" desde={desde} hasta={hasta} />

      {resumen && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Cifra
            titulo="Unidades en taller"
            valor={String(resumen.ordenes_abiertas)}
            nota={
              resumen.unidades_atrasadas > 0
                ? `${resumen.unidades_atrasadas} pasaron su fecha`
                : 'ninguna fuera de plazo'
            }
            tono={resumen.unidades_atrasadas > 0 ? 'peligro' : 'neutro'}
          />
          <Cifra
            titulo="Entregas del período"
            valor={String(resumen.ordenes_entregadas)}
            nota={
              puntualidad === null
                ? 'sin entregas todavía'
                : `${porcentaje(puntualidad, 0)} a tiempo`
            }
            tono={puntualidad !== null && puntualidad < 80 ? 'aviso' : 'neutro'}
          />
          <Cifra
            titulo="Horas de taller"
            valor={cantidad(resumen.horas_taller)}
            nota="de partes aprobados"
          />
          {resumen.utilidad_periodo !== null ? (
            <Cifra
              titulo="Utilidad del período"
              valor={moneda(resumen.utilidad_periodo)}
              nota={`sobre ${moneda(resumen.venta_periodo ?? 0)} de venta`}
              tono={Number(resumen.utilidad_periodo) < 0 ? 'peligro' : 'exito'}
            />
          ) : (
            <Cifra
              titulo="Utilidad del período"
              valor="—"
              nota="tu perfil no ve información de costos"
            />
          )}
        </div>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {informes.map((informe) => (
          <Link
            key={informe.clave}
            href={`/informes/${informe.clave}?desde=${desde}&hasta=${hasta}`}
            className="group"
          >
            <Tarjeta className="h-full transition-colors group-hover:border-acento">
              <TarjetaCuerpo className="flex h-full flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <BarChart3 aria-hidden className="size-5 shrink-0 text-acento" />
                  <ArrowRight
                    aria-hidden
                    className="size-4 shrink-0 text-texto-tenue transition-transform group-hover:translate-x-0.5 group-hover:text-acento"
                  />
                </div>
                <p className="text-sm font-semibold text-texto">{informe.titulo}</p>
                <p className="text-xs text-texto-suave">{informe.descripcion}</p>
                <p className="mt-auto pt-2 text-xs text-texto-tenue italic">{informe.pregunta}</p>
              </TarjetaCuerpo>
            </Tarjeta>
          </Link>
        ))}
      </div>

      <p className="mt-4 text-xs text-texto-tenue">
        Los informes que muestran plata piden además el permiso de costos: quien no lo tiene ve la
        producción y las entregas, pero no el margen ni lo que se le paga a los proveedores.
      </p>
    </>
  )
}

function Cifra({
  titulo,
  valor,
  nota,
  tono = 'neutro',
}: {
  titulo: string
  valor: string
  nota?: string
  tono?: 'neutro' | 'exito' | 'aviso' | 'peligro'
}) {
  const color = {
    neutro: 'text-texto',
    exito: 'text-exito',
    aviso: 'text-aviso',
    peligro: 'text-peligro',
  }[tono]

  return (
    <Tarjeta>
      <TarjetaCuerpo>
        <p className="text-[11px] font-medium tracking-wide text-texto-suave uppercase">{titulo}</p>
        <p className={`tabular mt-1 text-lg font-semibold ${color}`}>{valor}</p>
        {nota && <p className="mt-0.5 text-xs text-texto-tenue">{nota}</p>}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
