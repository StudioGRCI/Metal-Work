import { FileText, MapPin, Phone, Receipt, Scale, User } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { BASE_BOTON, TAMANOS, VARIANTES } from '@/components/ui/boton'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarRecojos, type CompraParaRecojo } from '@/lib/datos/logistica'
import { enlaceAlMapa, pasosDelDia, RECOJO_COMPRA, telefonosParaLlamar } from '@/lib/dominio/logistica'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { cantidad, diaLima, fecha, fechaHora, hora, hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { PasoRecojo } from './paso-recojo'

export const metadata = { title: 'Recojos' }

/** Lo que el conductor marca después, según en qué va el recojo. */
const SIGUIENTE_PASO: Record<string, 'EN_RECOJO' | 'RECOGIDO' | 'DEJADO'> = {
  POR_RECOGER: 'EN_RECOJO',
  EN_RECOJO: 'RECOGIDO',
  RECOGIDO: 'DEJADO',
}

export default async function PaginaRecojos() {
  // Logística la sigue desde aquí; quien solo emite compras, no (migración 20261020171000).
  const perfil = await exigirPermiso(['compras.recojo', 'compras.programar_recojo'])
  const conductor = puede(perfil, 'compras.recojo')
  const recojos = await cargarRecojos()
  // Lo que lleva encima va primero; después, la lista que le programó
  // Logística, en su orden. La base ya las devuelve así.
  const pendientes = recojos.filter((r) => r.recojo === 'EN_RECOJO' || r.recojo === 'RECOGIDO' || (r.recojo === 'POR_RECOGER' && r.en_lista))
  const sinProgramar = recojos.filter((r) => r.recojo === 'POR_RECOGER' && !r.en_lista)
  const dejadas = recojos.filter((r) => r.recojo === 'DEJADO')
  // Lo recogido y lo dejado hoy, con su hora: sale de las horas que ya guarda cada compra.
  const deHoy = pasosDelDia(recojos, hoyLima(), diaLima)

  return (
    <>
      <EncabezadoPagina
        titulo="Recojos"
        ayuda={
          conductor
            ? 'Las compras que Logística te programó, en el orden en que tienes que recogerlas, con su peso y su guía de remisión. Marca «Salgo a recoger» cuando vas al proveedor, «Ya la recogí» al salir con el material y «La dejé en almacén» al entregarla: el requerimiento muestra en qué va y Almacén valida el ingreso sin volver a registrarlo. En cada parada puedes llamar al proveedor y abrir su dirección en el mapa; abajo queda lo que recogiste y dejaste hoy, con su hora.'
            : 'Lo que el conductor tiene que recoger, en el orden que le programó Logística, lo que recogió y dejó hoy con su hora, y lo que ya dejó en almacén esta semana.'
        }
      />

      <div className="space-y-6">
        <section className="space-y-3">
          <h2 className="text-base font-semibold text-texto">
            Por hacer <span className="tabular text-texto-suave">({pendientes.length})</span>
          </h2>
          {pendientes.length === 0 ? (
            <Tarjeta>
              <SinDatos
                enTabla={false}
                titulo="No hay nada por recoger"
                descripcion="Cuando Logística te programe una compra para recoger, aparece aquí con su peso y te llega un aviso."
              />
            </Tarjeta>
          ) : (
            pendientes.map((r) => <TarjetaRecojo key={r.id} recojo={r} conductor={conductor} />)
          )}
          {sinProgramar.length > 0 && (
            <p className="text-sm text-texto-suave">
              <span className="tabular font-semibold text-texto">{sinProgramar.length}</span>{' '}
              {sinProgramar.length === 1 ? 'compra aprobada espera' : 'compras aprobadas esperan'} que Logística{' '}
              {sinProgramar.length === 1 ? 'la programe' : 'las programe'}
              {conductor ? `: todavía no salgas a ${sinProgramar.length === 1 ? 'recogerla' : 'recogerlas'}.` : '. '}
              {!conductor && (
                <Link className="text-acento hover:underline" href="/compras/gestion">
                  Programarlas en Gestión de compras
                </Link>
              )}
            </p>
          )}
        </section>

        <section className="space-y-3" aria-labelledby="recojos-de-hoy">
          <h2 id="recojos-de-hoy" className="text-base font-semibold text-texto">
            Recogido y dejado hoy <span className="tabular text-texto-suave">({deHoy.length})</span>
          </h2>
          {deHoy.length === 0 ? (
            <p className="text-sm text-texto-suave">
              {conductor ? 'Todavía no recoges ni dejas nada hoy.' : 'El conductor todavía no recoge ni deja nada hoy.'}
            </p>
          ) : (
            <Tarjeta>
              <ol className="divide-y divide-borde">
                {deHoy.map((p) => (
                  <li key={`${p.compra}-${p.paso}`} className="flex items-center gap-3 px-4 py-3 text-sm">
                    <span className="tabular w-12 shrink-0 font-semibold text-texto">{hora(p.en)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-texto">{p.nombre}</span>
                      <span className="block truncate text-xs text-texto-suave">{p.proveedor}</span>
                    </span>
                    <Insignia tono={p.paso === 'DEJADO' ? 'exito' : 'info'}>{p.paso === 'DEJADO' ? 'Dejada en almacén' : 'Recogida'}</Insignia>
                  </li>
                ))}
              </ol>
            </Tarjeta>
          )}
        </section>

        {dejadas.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-texto">Dejadas en almacén esta semana</h2>
            {dejadas.map((r) => (
              <TarjetaRecojo key={r.id} recojo={r} conductor={false} />
            ))}
          </section>
        )}
      </div>
    </>
  )
}

function TarjetaRecojo({ recojo: r, conductor }: { recojo: CompraParaRecojo; conductor: boolean }) {
  const estado = RECOJO_COMPRA[r.recojo]
  // Llamar y abrir el mapa sirven mientras la compra está en la ruta; ya dejada, quedan los datos.
  const enRuta = r.recojo !== 'DEJADO'
  const telefonos = telefonosParaLlamar(r.proveedor_telefono)
  const aQuien = r.proveedor_contacto?.trim() || r.proveedor
  return (
    <Tarjeta>
      <TarjetaCabecera
        // La OC de antes de la serie no tiene número: «OC sin número», y la referencia que el proveedor reconoce.
        titulo={`${r.recojo === 'POR_RECOGER' && r.lugar ? `${r.lugar}.º · ` : ''}${r.numero ?? 'OC sin número'} · ${r.proveedor}`}
        descripcion={[
          r.numero === null ? `Ref. del proveedor: ${r.referencia}` : r.referencia && r.referencia !== r.numero ? `Ref. ${r.referencia}` : null,
          r.codigo_interno ? `Para ${r.codigo_interno}` : null,
          r.origen === 'DIRECTA' ? 'Para el almacén' : r.ordenes.length ? `OT ${r.ordenes.join(', ')}` : null,
          r.fecha_estimada ? `Lista desde ${fecha(r.fecha_estimada)}` : null,
        ]
          .filter(Boolean)
          .join(' · ')}
        acciones={estado && <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia>}
      />
      <TarjetaCuerpo className="space-y-4">
        <ul className="space-y-1 text-sm text-texto">
          {r.proveedor_direccion && (
            <li className="flex items-start gap-2">
              <MapPin aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              <span>{r.proveedor_direccion}</span>
            </li>
          )}
          {r.proveedor_telefono && !(enRuta && telefonos.length > 0) && (
            <li className="flex items-center gap-2">
              <Phone aria-hidden className="size-4 shrink-0 text-texto-suave" />
              <span className="tabular">{r.proveedor_telefono}</span>
            </li>
          )}
          {r.proveedor_contacto && (
            <li className="flex items-center gap-2">
              <User aria-hidden className="size-4 shrink-0 text-texto-suave" />
              {r.proveedor_contacto}
            </li>
          )}
          {r.peso_kg !== null && (
            <li className="flex items-center gap-2">
              <Scale aria-hidden className="size-4 shrink-0 text-texto-suave" />
              <span>
                Pesa <span className="tabular font-semibold">{cantidad(r.peso_kg)} kg</span>
              </span>
            </li>
          )}
          {r.recojo !== 'DEJADO' && (
            <li className="flex items-start gap-2">
              <FileText aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              {r.guia ? (
                <Link className="font-medium text-acento hover:underline" href={`/compras/guia/${r.guia.id}`} target="_blank" prefetch={false}>
                  Guía de remisión {r.guia.numero} (PDF)
                </Link>
              ) : (
                <span className="text-aviso">Contabilidad todavía no carga la guía de remisión.</span>
              )}
            </li>
          )}
          {r.recojo !== 'DEJADO' && (
            <li className="flex items-start gap-2">
              <Receipt aria-hidden className="mt-0.5 size-4 shrink-0 text-texto-suave" />
              <span>
                <span className="font-medium">{comprobantePedido(r.con_factura).etiqueta}.</span> {comprobantePedido(r.con_factura).pide}
              </span>
            </li>
          )}
          {!r.proveedor_direccion && !r.proveedor_telefono && (
            <li className="text-xs text-texto-suave">El proveedor no tiene dirección ni teléfono en el padrón: pídeselos a Logística.</li>
          )}
        </ul>

        {enRuta && (r.proveedor_direccion || telefonos.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {r.proveedor_direccion && (
              <a
                className={cn(BASE_BOTON, VARIANTES.contorno, TAMANOS.lg, 'flex-1 justify-center px-4 sm:flex-none')}
                href={enlaceAlMapa(r.proveedor_direccion)}
                target="_blank"
                rel="noreferrer"
                aria-label={`Abrir en el mapa la dirección de ${r.proveedor}`}
              >
                <MapPin aria-hidden className="size-4" />
                Abrir en el mapa
              </a>
            )}
            {telefonos.map((t) => (
              <a
                key={t.numero}
                className={cn(BASE_BOTON, VARIANTES.contorno, TAMANOS.lg, 'tabular flex-1 justify-center px-4 sm:flex-none')}
                href={`tel:${t.numero}`}
                aria-label={`Llamar a ${aQuien} al ${t.texto}`}
              >
                <Phone aria-hidden className="size-4" />
                Llamar {t.texto}
              </a>
            ))}
          </div>
        )}

        <ul className="divide-y divide-borde rounded-md border border-borde">
          {r.lineas.map((l, i) => (
            <li key={`${l.material_codigo}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <div className="min-w-0">
                <p className="text-texto">{l.material}</p>
                <p className="text-[11px] text-texto-suave">{[l.material_codigo, l.orden ? `OT ${l.orden}` : null].filter(Boolean).join(' · ')}</p>
              </div>
              <p className="tabular shrink-0 font-semibold text-texto">
                {cantidad(l.cantidad)} {l.unidad}
              </p>
            </li>
          ))}
        </ul>

        <p className="text-xs text-texto-suave">
          {[
            r.pedido_en && `Mandada a recojo ${fechaHora(r.pedido_en)}`,
            r.en_recojo_en && `salió a recogerla ${fechaHora(r.en_recojo_en)}`,
            r.recogido_en && `recogida ${fechaHora(r.recogido_en)}`,
            r.dejado_en && `dejada en almacén ${fechaHora(r.dejado_en)}`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>

        {/* Sale a recoger solo lo que Logística le programó; la base también lo exige. */}
        {conductor && SIGUIENTE_PASO[r.recojo] && (r.recojo !== 'POR_RECOGER' || r.en_lista) && (
          <PasoRecojo id={r.id} nombre={r.nombre} paso={SIGUIENTE_PASO[r.recojo]} />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
