import Link from 'next/link'
import { AlertTriangle, ClipboardList, Factory, PauseCircle, Plus, Zap } from 'lucide-react'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { EnlaceBoton } from '@/components/ui/enlace-boton'
import { Indicador } from '@/components/ui/indicador'
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
      <EncabezadoPagina
        titulo={`Hola, ${perfil.nombres}`}
        // «El menú» y no «la barra lateral»: en el teléfono es el botón de
        // arriba, y a esta pantalla llega justamente quien todavía no sabe
        // dónde está lo suyo.
        descripcion="Abre el menú para entrar a los módulos habilitados para tu perfil."
      />
    )
  }

  const [indicadores, { ordenes }] = await Promise.all([
    indicadoresTablero(),
    listarOrdenes({ estado: 'ABIERTAS', pagina: 1 }),
  ])

  const atrasadas = ordenes.filter((o) => (o.dias_atraso ?? 0) > 0)
  const puedeCrear = puede(perfil, 'ordenes.crear')
  // Para el pie de «Órdenes abiertas»: un número suelto no dice si son muchas
  // o pocas hasta que se ve contra el total registrado.
  const totalOrdenes = indicadores.porEstado.reduce((suma, e) => suma + e.cantidad, 0)

  return (
    <>
      <EncabezadoPagina
        titulo={`Hola, ${perfil.nombres}`}
        descripcion="Estado del taller al día de hoy."
      />

      {/* Dos columnas ya en el teléfono: cinco tarjetas apiladas ocupaban una
          pantalla entera antes de llegar a la lista de órdenes. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Indicador
          icono={ClipboardList}
          titulo="Órdenes abiertas"
          valor={indicadores.abiertas}
          pie={`de ${totalOrdenes} registradas`}
          href="/ordenes?estado=ABIERTAS"
        />
        <Indicador
          icono={Factory}
          titulo="En proceso"
          valor={indicadores.enProceso}
          tono="acento"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=EN_PROCESO"
        />
        <Indicador
          icono={PauseCircle}
          titulo="Pausadas"
          valor={indicadores.pausadas}
          tono="aviso"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=PAUSADA"
        />
        <Indicador
          icono={AlertTriangle}
          titulo="Atrasadas"
          valor={indicadores.atrasadas}
          tono="peligro"
          pie="pasaron la fecha comprometida"
          href="/ordenes?estado=ABIERTAS&atrasadas=1"
        />
        <Indicador
          icono={Zap}
          titulo="Urgentes"
          valor={indicadores.urgentes}
          tono="peligro"
          pie={`de ${indicadores.abiertas} abiertas`}
          href="/ordenes?estado=ABIERTAS&prioridad=URGENTE"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Tarjeta className="lg:col-span-2">
          <TarjetaCabecera
            titulo="Órdenes en taller"
            descripcion="Lo que está abierto ahora mismo, por fecha de registro"
            acciones={
              <Link
                href="/ordenes?estado=ABIERTAS"
                className="inline-flex min-h-11 items-center text-xs text-acento hover:underline sm:min-h-0"
              >
                Ver todas
              </Link>
            }
          />
          <TarjetaCuerpo className="space-y-3">
            {ordenes.length === 0 ? (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-texto">No hay órdenes abiertas</p>
                <p className="mt-1 text-xs text-texto-suave">
                  En cuanto se apruebe una, aparece acá con su avance.
                </p>
                {puedeCrear && (
                  <div className="mt-4 flex justify-center">
                    <EnlaceBoton href="/ordenes/nueva" tamano="sm">
                      <Plus aria-hidden className="size-3.5" />
                      Nueva orden
                    </EnlaceBoton>
                  </div>
                )}
              </div>
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
                    {/* La barra cede ancho en el teléfono: con 128 px fijos el
                        número de orden y el cliente quedaban recortados. */}
                    <div className="w-20 shrink-0 sm:w-32">
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
                <p className="py-4 text-center text-sm text-texto-suave">
                  Todavía no hay ninguna orden registrada.
                </p>
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
                      // El conteo lleva a su lista filtrada: era un número que
                      // no llevaba a ninguna parte y obligaba a repetir el
                      // filtro a mano en Órdenes.
                      <Link
                        key={estado}
                        href={`/ordenes?estado=${estado}`}
                        className="flex min-h-11 items-center justify-between gap-2 rounded-[var(--radius-base)] text-sm hover:bg-superficie-2 sm:min-h-0"
                      >
                        <Insignia tono={def.tono}>{def.etiqueta}</Insignia>
                        <span className="tabular font-medium text-texto">{cantidad}</span>
                      </Link>
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
