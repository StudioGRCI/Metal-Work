import { ArrowRight, BarChart3 } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Indicador } from '@/components/ui/indicador'
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

  // Cada cifra lleva al informe que la explica, pero solo si el perfil puede
  // abrirlo: `informesVisibles` ya filtró por permiso, así que preguntarle a
  // esa lista evita ofrecer un enlace que termina en «sin permiso».
  const periodo = `desde=${desde}&hasta=${hasta}`
  const enlaceInforme = (clave: string) =>
    informes.some((i) => i.clave === clave) ? `/informes/${clave}?${periodo}` : undefined

  return (
    <>
      <EncabezadoPagina
        titulo="Informes"
        descripcion="Las preguntas del mes: si el taller gana o pierde, si entrega cuando promete y en qué se va el material."
      />

      <RangoDeFechas ruta="/informes" desde={desde} hasta={hasta} />

      {resumen && (
        // Dos columnas ya en el teléfono; en el monitor sigue el mismo salto de
        // dos a cuatro de siempre.
        <div className="mt-4 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
          <Indicador
            titulo="Unidades en taller"
            valor={String(resumen.ordenes_abiertas)}
            pie={
              resumen.unidades_atrasadas > 0
                ? `${resumen.unidades_atrasadas} pasaron su fecha`
                : 'ninguna fuera de plazo'
            }
            tono={resumen.unidades_atrasadas > 0 ? 'peligro' : 'neutro'}
            href="/ordenes?estado=ABIERTAS"
          />
          <Indicador
            titulo="Entregas del período"
            valor={String(resumen.ordenes_entregadas)}
            pie={
              puntualidad === null
                ? 'sin entregas todavía'
                : `${porcentaje(puntualidad, 0)} a tiempo`
            }
            tono={puntualidad !== null && puntualidad < 80 ? 'aviso' : 'neutro'}
            href={enlaceInforme('cumplimiento')}
          />
          <Indicador
            titulo="Horas de taller"
            valor={cantidad(resumen.horas_taller)}
            pie="de partes aprobados"
            href={enlaceInforme('produccion')}
          />
          {resumen.utilidad_periodo !== null ? (
            <Indicador
              titulo="Utilidad del período"
              valor={moneda(resumen.utilidad_periodo)}
              pie={`sobre ${moneda(resumen.venta_periodo ?? 0)} de venta`}
              tono={Number(resumen.utilidad_periodo) < 0 ? 'peligro' : 'exito'}
              href={enlaceInforme('rentabilidad')}
            />
          ) : (
            <Indicador
              titulo="Utilidad del período"
              valor="—"
              pie="tu perfil no ve información de costos"
            />
          )}
        </div>
      )}

      {informes.length === 0 ? (
        <Tarjeta className="mt-6">
          <TarjetaCuerpo className="py-10 text-center">
            <p className="text-sm font-medium text-texto">Ningún informe habilitado</p>
            <p className="mt-1 text-xs text-texto-suave">
              Tu perfil ve las cifras de arriba, pero no los informes que las detallan. Pídeselos al
              administrador del sistema.
            </p>
          </TarjetaCuerpo>
        </Tarjeta>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {informes.map((informe) => (
            <Link key={informe.clave} href={`/informes/${informe.clave}?${periodo}`} className="group">
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
      )}

      <p className="mt-4 text-xs text-texto-tenue">
        Los informes que muestran plata piden además el permiso de costos: quien no lo tiene ve la
        producción y las entregas, pero no el margen ni lo que se le paga a los proveedores.
      </p>
    </>
  )
}
