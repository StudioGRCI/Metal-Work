import { Camera } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { DiasEnEspera } from '@/components/ui/dias-en-espera'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCuerpo } from '@/components/ui/tarjeta'
import { listarReclamos, MAXIMO_ABIERTOS, MAXIMO_RECLAMOS, unidadesParaReclamar, type ReclamoGarantia } from '@/lib/datos/garantias'
import { CAUSA_GARANTIA, SITUACION_RECLAMO, SITUACIONES_ABIERTAS } from '@/lib/dominio/garantias'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDelReclamo, RegistrarReclamo } from './formulario'

export const metadata = { title: 'Reclamos de garantía' }

const VISTAS = [
  { valor: 'abiertos', titulo: 'Abiertos' },
  { valor: 'cerrados', titulo: 'Cerrados' },
  { valor: 'anulados', titulo: 'Anulados' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const abierto = (r: ReclamoGarantia) => (SITUACIONES_ABIERTAS as readonly string[]).includes(r.situacion)

/** Lo que le toca a quien mira, para ponerlo arriba de la lista: lo dice la base en cada reclamo. */
const leToca = (r: ReclamoGarantia) => r.puede_causa || r.puede_enlazar

/**
 * Los reclamos de garantía (plan «Las demás áreas», A.2). Ventas los registra,
 * Administración abre su OT de garantía, Calidad anota la causa y Gerencia los
 * consulta; el área de Garantías también los ve. Qué ve cada quien y qué puede
 * hacer en cada uno lo decide la base (`garantias_reclamos_visibles`).
 */
export default async function PaginaGarantias({ searchParams }: PageProps<'/garantias'>) {
  const perfil = await exigirSesion()
  // El mismo permiso que pide `garantias_registrar`.
  const registra = puede(perfil, 'garantias.registrar')
  const soloConsulta = !puede(perfil, ['garantias.registrar', 'garantias.atender', 'garantias.causa'])
  const params = await searchParams
  const pedida = typeof params.vista === 'string' ? params.vista : ''
  const vista: Vista = VISTAS.some((v) => v.valor === pedida) ? (pedida as Vista) : 'abiertos'
  const busqueda = typeof params.buscar === 'string' ? params.buscar.trim() : ''

  const [reclamos, unidades] = await Promise.all([listarReclamos(busqueda), registra ? unidadesParaReclamar() : Promise.resolve(null)])
  const grupos: Record<Vista, ReclamoGarantia[]> = {
    // Lo que le toca a quien mira, primero; después lo demás, del más reciente al más viejo.
    abiertos: reclamos.filter(abierto).sort((x, y) => Number(leToca(y)) - Number(leToca(x))),
    cerrados: reclamos.filter((r) => r.situacion === 'CERRADO' || r.situacion === 'NO_PROCEDE'),
    anulados: reclamos.filter((r) => r.situacion === 'ANULADO'),
  }
  const toca = grupos.abiertos.filter(leToca).length
  const alTope = reclamos.filter(abierto).length >= MAXIMO_ABIERTOS || reclamos.filter((r) => !abierto(r)).length >= MAXIMO_RECLAMOS

  return (
    <>
      <EncabezadoPagina
        titulo="Reclamos de garantía"
        descripcion={
          soloConsulta
            ? 'Solo consulta.'
            : toca > 0
              ? `${toca} ${toca === 1 ? 'reclamo espera' : 'reclamos esperan'} lo que te toca.`
              : undefined
        }
        ayuda="El cliente vuelve con su unidad por algo que hizo el taller. Ventas registra el reclamo con su número RG, Administración abre su OT de garantía (o lo cierra como «No procede», con su motivo) y, cuando la garantía está terminada, Calidad anota por qué falló y el reclamo se cierra. Un reclamo no se borra: sin OT, se anula con su motivo."
        migas={[{ titulo: 'Garantías' }]}
        acciones={unidades && unidades.length > 0 && <RegistrarReclamo cuentaId={perfil.id} unidades={unidades} />}
        estado={registra ? <EstadoDelReclamo /> : undefined}
      />
      {unidades && unidades.length === 0 && <SinUnidades />}
      <div className="mb-3 space-y-3">
        <BuscadorSimple ruta="/garantias" clave="buscar" etiqueta="Buscar reclamos" marcador="Número RG, placa, código interno, cliente u OT" />
        <Vistas
          etiqueta="Vista"
          vistas={VISTAS.map((v) => ({
            clave: v.valor,
            titulo: v.titulo,
            href: conBusqueda(v.valor === 'abiertos' ? '/garantias' : `/garantias?vista=${v.valor}`, busqueda),
            activa: vista === v.valor,
            cuenta: grupos[v.valor].length,
          }))}
        />
      </div>
      <Tarjeta className="overflow-hidden">
        <TablaDeReclamos
          reclamos={grupos[vista]}
          vacio={
            busqueda
              ? { titulo: 'Ninguno con esa búsqueda', descripcion: 'Prueba con otro número, placa, código interno o cliente, o en otra vista.' }
              : vista === 'abiertos'
                ? {
                    titulo: 'No hay reclamos abiertos',
                    descripcion: registra
                      ? 'Cuando un cliente vuelva por garantía, toca «Registrar reclamo».'
                      : 'Cuando Ventas registre un reclamo, aparece aquí y en la campana de quien tiene que atenderlo.',
                  }
                : vista === 'cerrados'
                  ? { titulo: 'Todavía no hay reclamos cerrados', descripcion: 'Un reclamo se cierra con la causa que anota Calidad, o como «No procede».' }
                  : { titulo: 'No hay reclamos anulados', descripcion: 'Un reclamo sin OT se anula desde su ficha, con su motivo.' }
          }
        />
      </Tarjeta>
      {alTope && (
        <p className="mt-3 text-xs text-texto-suave">
          Se muestran todos los abiertos y los {MAXIMO_RECLAMOS} cerrados o anulados más recientes. Busca para encontrar uno más viejo.
        </p>
      )}
    </>
  )
}

function conBusqueda(ruta: string, busqueda: string) {
  if (!busqueda) return ruta
  return `${ruta}${ruta.includes('?') ? '&' : '?'}buscar=${encodeURIComponent(busqueda)}`
}

/** Sin unidades no hay qué elegir: en vez de una ventana que no deja enviar, se dice por qué y qué hacer. */
function SinUnidades() {
  return (
    <Tarjeta className="mb-5">
      <TarjetaCuerpo data-sin-unidades>
        <SinDatos
          compacto
          titulo="Todavía no hay unidades registradas"
          descripcion="El reclamo va con la unidad que vuelve. Regístrala primero en Unidades, con su cliente, y vuelve aquí."
        />
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

/** «ABC-123 · M-0045 · Furgón». */
const unidadDe = (r: ReclamoGarantia) => [r.placa ?? 'Sin placa', r.codigo_interno, r.carroceria].filter(Boolean).join(' · ')

function TablaDeReclamos({ reclamos, vacio }: { reclamos: ReclamoGarantia[]; vacio: { titulo: string; descripcion: string } }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Reclamo</TH>
          <TH className="hidden md:table-cell">Unidad y cliente</TH>
          <TH className="hidden lg:table-cell">OT de garantía</TH>
          <TH className="hidden sm:table-cell">Registrado</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {reclamos.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          reclamos.map((r) => <FilaReclamo key={r.id} reclamo={r} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaReclamo({ reclamo: r }: { reclamo: ReclamoGarantia }) {
  const causa = r.causa ? CAUSA_GARANTIA[r.causa] : null
  return (
    <TR data-reclamo={r.numero} data-situacion={r.situacion} data-le-toca={leToca(r) || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el número es el único camino a la ficha. */}
          <Link href={`/garantias/${r.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {r.numero}
          </Link>
          {leToca(r) && <Insignia tono="acento">Te toca</Insignia>}
          {causa && <Insignia tono={causa.tono}>{causa.etiqueta}</Insignia>}
        </div>
        <p className="mt-1 text-sm font-medium text-texto md:hidden">{unidadDe(r)}</p>
        <p className="mt-0.5 text-xs text-texto-suave md:hidden">{r.cliente}</p>
        <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto">{r.descripcion}</p>
        {r.fotos > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-texto-suave">
            <Camera aria-hidden className="size-3.5" />
            {r.fotos} {r.fotos === 1 ? 'foto' : 'fotos'}
          </p>
        )}
        {r.orden_numero && <p className="tabular mt-1 text-xs text-texto-suave lg:hidden">OT {r.orden_numero}</p>}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="tabular text-xs text-texto-suave">{fechaHora(r.creado_en)}</p>
          <Situacion reclamo={r} />
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{unidadDe(r)}</p>
        <p className="max-w-[16rem] text-xs text-texto-suave">{r.cliente}</p>
      </TD>
      <TD className="hidden align-top lg:table-cell">
        <p className="tabular text-sm text-texto">{r.orden_numero ?? '—'}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fechaHora(r.creado_en)}</p>
        <p className="text-xs text-texto-suave">{[r.registro, r.registro_puesto].filter(Boolean).join(' · ')}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Situacion reclamo={r} />
      </TD>
    </TR>
  )
}

/** En qué está el reclamo, a quién espera y desde cuándo. */
function Situacion({ reclamo: r }: { reclamo: ReclamoGarantia }) {
  const s = SITUACION_RECLAMO[r.situacion]
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {s ? <Insignia tono={s.tono}>{s.etiqueta}</Insignia> : r.situacion}
      <DiasEnEspera dias={r.dias_en_espera} desde={r.creado_en} quien={s?.quien} />
    </div>
  )
}
