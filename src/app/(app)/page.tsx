import Link from 'next/link'
import { AlertTriangle, ClipboardList, Factory, PauseCircle, Zap } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { Progreso } from '@/components/ui/progreso'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { ESTADO_OT, ORDEN_ESTADO_OT, definir } from '@/lib/dominio/estados'
import { fecha } from '@/lib/format'
import { indicadoresTablero, listarOrdenes } from '@/lib/datos/ordenes'
import { exigirSesion, puede } from '@/lib/sesion'

export const metadata = { title: 'Tablero' }

export default async function PaginaTablero() {
  const perfil = await exigirSesion()

  if (!puede(perfil, 'ordenes.ver')) {
    return (
      <>
        <EncabezadoPagina
          titulo={`Hola, ${perfil.nombres}`}
          descripcion="Usa el menú lateral para acceder a los módulos habilitados para tu perfil."
        />
      </>
    )
  }

  const [indicadores, { ordenes }] = await Promise.all([
    indicadoresTablero(),
    listarOrdenes({ estado: 'ABIERTAS', pagina: 1 }),
  ])

  const atrasadas = ordenes.filter((o) => (o.dias_atraso ?? 0) > 0)

  return (
    <>
      <EncabezadoPagina
        titulo={`Hola, ${perfil.nombres}`}
        descripcion="Estado del taller al día de hoy."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Indicador icono={ClipboardList} titulo="Órdenes abiertas" valor={indicadores.abiertas} />
        <Indicador icono={Factory} titulo="En proceso" valor={indicadores.enProceso} tono="acento" />
        <Indicador icono={PauseCircle} titulo="Pausadas" valor={indicadores.pausadas} tono="aviso" />
        <Indicador icono={AlertTriangle} titulo="Atrasadas" valor={indicadores.atrasadas} tono="peligro" />
        <Indicador icono={Zap} titulo="Urgentes" valor={indicadores.urgentes} tono="peligro" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Órdenes en taller"
            descripcion="Lo que está abierto ahora mismo, por fecha de registro"
            acciones={
              <Link href="/ordenes?estado=ABIERTAS" className="text-xs text-acento hover:underline">
                Ver todas
              </Link>
            }
          />
          <TarjetaCuerpo className="space-y-3">
            {ordenes.length === 0 ? (
              <p className="py-8 text-center text-sm text-texto-suave">
                No hay órdenes abiertas en este momento.
              </p>
            ) : (
              ordenes.slice(0, 8).map((orden) => {
                const estado = definir(ESTADO_OT, orden.estado)
                return (
                  <Link
                    key={orden.id}
                    href={`/ordenes/${orden.id}`}
                    className="flex items-center gap-3 rounded-[var(--radius-base)] p-2 hover:bg-superficie-2"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 text-sm font-medium text-texto">
                        {orden.numero}
                        <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>
                      </p>
                      <p className="truncate text-xs text-texto-suave">
                        {orden.cliente}
                        {orden.placa ? ` · ${orden.placa}` : ''}
                      </p>
                    </div>
                    <div className="w-32 shrink-0">
                      <Progreso valor={orden.avance_porcentaje} mostrarValor alto="sm" />
                    </div>
                  </Link>
                )
              })
            )}
          </TarjetaCuerpo>
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta>
            <TarjetaCabecera titulo="Por estado" />
            <TarjetaCuerpo className="space-y-2">
              {indicadores.porEstado.length === 0 ? (
                <p className="py-4 text-center text-sm text-texto-suave">Sin datos.</p>
              ) : (
                [...indicadores.porEstado]
                  .sort(
                    (a, b) =>
                      ORDEN_ESTADO_OT.indexOf(a.estado as never) -
                      ORDEN_ESTADO_OT.indexOf(b.estado as never),
                  )
                  .map(({ estado, cantidad }) => {
                    const def = definir(ESTADO_OT, estado)
                    return (
                      <div key={estado} className="flex items-center justify-between gap-2 text-sm">
                        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                        <span className="tabular font-medium text-texto">{cantidad}</span>
                      </div>
                    )
                  })
              )}
            </TarjetaCuerpo>
          </Tarjeta>

          <Tarjeta>
            <TarjetaCabecera
              titulo="Requieren atención"
              descripcion="Órdenes que pasaron su fecha de entrega comprometida"
            />
            <TarjetaCuerpo className="space-y-2">
              {atrasadas.length === 0 ? (
                <p className="py-4 text-center text-sm text-exito">
                  Ninguna orden atrasada. Buen trabajo.
                </p>
              ) : (
                atrasadas.slice(0, 6).map((orden) => (
                  <Link
                    key={orden.id}
                    href={`/ordenes/${orden.id}`}
                    className="block rounded-[var(--radius-base)] p-2 hover:bg-superficie-2"
                  >
                    <p className="text-sm font-medium text-texto">{orden.numero}</p>
                    <p className="text-xs text-peligro">
                      {orden.dias_atraso} {orden.dias_atraso === 1 ? 'día' : 'días'} · comprometida el{' '}
                      {fecha(orden.fecha_entrega_comprometida)}
                    </p>
                  </Link>
                ))
              )}
            </TarjetaCuerpo>
          </Tarjeta>
        </div>
      </div>
    </>
  )
}

function Indicador({
  icono: Icono,
  titulo,
  valor,
  tono = 'neutro',
}: {
  icono: typeof ClipboardList
  titulo: string
  valor: number
  tono?: 'neutro' | 'acento' | 'aviso' | 'peligro'
}) {
  const color = {
    neutro: 'text-texto-suave',
    acento: 'text-acento',
    aviso: 'text-aviso',
    peligro: 'text-peligro',
  }[tono]

  return (
    <Tarjeta>
      <TarjetaCuerpo className="flex items-center gap-3">
        <Icono aria-hidden className={`size-5 shrink-0 ${color}`} />
        <div className="min-w-0">
          <p className="tabular text-2xl leading-none font-semibold text-texto">{valor}</p>
          <p className="mt-1 text-xs text-texto-suave">{titulo}</p>
        </div>
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
