import { FileText, MapPin, Phone, Receipt, Scale, User } from 'lucide-react'
import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { cargarRecojos, type CompraParaRecojo } from '@/lib/datos/logistica'
import { RECOJO_COMPRA } from '@/lib/dominio/logistica'
import { comprobantePedido } from '@/lib/dominio/proveedores'
import { cantidad, fecha, fechaHora } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'

import { PasoRecojo } from './paso-recojo'

export const metadata = { title: 'Recojos' }

/** Lo que el conductor marca después, según en qué va el recojo. */
const SIGUIENTE_PASO: Record<string, 'EN_RECOJO' | 'RECOGIDO' | 'DEJADO'> = {
  POR_RECOGER: 'EN_RECOJO',
  EN_RECOJO: 'RECOGIDO',
  RECOGIDO: 'DEJADO',
}

export default async function PaginaRecojos() {
  const perfil = await exigirPermiso(['compras.recojo', 'compras.crear'])
  const conductor = puede(perfil, 'compras.recojo')
  const recojos = await cargarRecojos()
  // Lo que lleva encima va primero; después, la lista que le programó
  // Logística, en su orden. La base ya las devuelve así.
  const pendientes = recojos.filter((r) => r.recojo === 'EN_RECOJO' || r.recojo === 'RECOGIDO' || (r.recojo === 'POR_RECOGER' && r.en_lista))
  const sinProgramar = recojos.filter((r) => r.recojo === 'POR_RECOGER' && !r.en_lista)
  const dejadas = recojos.filter((r) => r.recojo === 'DEJADO')

  return (
    <>
      <EncabezadoPagina
        titulo="Recojos"
        ayuda={
          conductor
            ? 'Las compras que Logística te programó, en el orden en que tienes que recogerlas, con su peso y su guía de remisión. Marca «Salgo a recoger» cuando vas al proveedor, «Ya la recogí» al salir con el material y «La dejé en almacén» al entregarla: el requerimiento muestra en qué va y Almacén valida el ingreso sin volver a registrarlo.'
            : 'Lo que el conductor tiene que recoger, en el orden que le programó Logística, y lo que ya dejó en almacén.'
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
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo={r.recojo === 'POR_RECOGER' && r.lugar ? `${r.lugar}.º · ${r.numero} · ${r.proveedor}` : `${r.numero} · ${r.proveedor}`}
        descripcion={[
          r.referencia && r.referencia !== r.numero ? `Ref. ${r.referencia}` : null,
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
              <a
                className="text-acento hover:underline"
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(r.proveedor_direccion)}`}
                target="_blank"
                rel="noreferrer"
              >
                {r.proveedor_direccion}
              </a>
            </li>
          )}
          {r.proveedor_telefono && (
            <li className="flex items-center gap-2">
              <Phone aria-hidden className="size-4 shrink-0 text-texto-suave" />
              <a className="tabular text-acento hover:underline" href={`tel:${r.proveedor_telefono.replace(/[^\d+]/g, '')}`}>
                {r.proveedor_telefono}
              </a>
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
                <Link className="font-medium text-acento hover:underline" href={`/compras/gestion/guia/${r.guia.id}`} target="_blank" prefetch={false}>
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
          <PasoRecojo id={r.id} numero={r.numero} paso={SIGUIENTE_PASO[r.recojo]} />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}
