import { Paperclip } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { AvisoEnfocado } from '@/components/ui/aviso-enfocado'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SeccionDesplegable } from '@/components/ui/seccion-desplegable'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import {
  listarTramites,
  MAXIMO_ANULADOS,
  MAXIMO_CONCLUIDOS,
  MAXIMO_VIVOS,
  tiposDeTramite,
  unidadesParaTramitar,
  type TipoDeTramite,
  type Tramite,
} from '@/lib/datos/tramites'
import {
  AMBITO_TRAMITE,
  AMBITOS_TRAMITE,
  diasDeAvisoEnTexto,
  nombreDeLaUnidad,
  PERMISOS_TRAMITES,
  plazoDelTramite,
  SITUACION_TRAMITE,
} from '@/lib/dominio/tramites'
import { fecha, hoyLima } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'
import { cn } from '@/lib/utils'

import { AvisoDelCatalogo, EstadoDelTramite, GuardarTipo, RegistrarTramite } from './formulario'

export const metadata = { title: 'Trámites' }

const VISTAS = [
  { valor: 'en-curso', titulo: 'En curso' },
  // Los que la entidad observó, aparte: el globo del menú de quien los lleva trae aquí.
  { valor: 'observados', titulo: 'Observados' },
  // Los que ya tienen su documento final (entrega 2): salen de «En curso» y dejan de contar plazo.
  { valor: 'concluidos', titulo: 'Concluidos' },
  { valor: 'por-anular', titulo: 'Por anular' },
  { valor: 'anulados', titulo: 'Anulados' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

/** Lo que vence primero, arriba; lo que no tiene fecha límite, al final, del más reciente al más viejo. */
function porPlazo(x: Tramite, y: Tramite) {
  if (x.dias_para_limite === null && y.dias_para_limite === null) return y.creado_en.localeCompare(x.creado_en)
  if (x.dias_para_limite === null) return 1
  if (y.dias_para_limite === null) return -1
  return x.dias_para_limite - y.dias_para_limite
}

/**
 * Los trámites (plan «El puesto de Tramitador», entregas 1 y 2). El Tramitador los
 * registra, los lleva y los cierra con su documento final; Gerencia y Administración los consultan, Ventas solo los
 * de una unidad, y Gerencia aprueba la anulación. Qué ve cada quien y qué puede
 * hacer en cada uno lo decide la base (`tramites_visibles`).
 */
export default async function PaginaTramites({ searchParams }: PageProps<'/tramites'>) {
  const perfil = await exigirSesion()
  if (!puede(perfil, [...PERMISOS_TRAMITES])) redirect('/sin-permiso')
  // Los mismos permisos que piden las funciones que escriben.
  const gestiona = puede(perfil, 'tramites.gestionar')
  const aprueba = puede(perfil, 'tramites.aprobar_anulacion')
  // El catálogo entero lo lee quien ve todos los trámites; Ventas, solo los de una unidad, no lo necesita.
  const veElCatalogo = puede(perfil, ['tramites.gestionar', 'tramites.ver'])
  const params = await searchParams
  const pedida = typeof params.vista === 'string' ? params.vista : ''
  const vistaPedida = VISTAS.some((v) => v.valor === pedida) ? (pedida as Vista) : null
  const busqueda = typeof params.buscar === 'string' ? params.buscar.trim() : ''

  const [tramites, tipos, unidades] = await Promise.all([
    listarTramites(busqueda),
    veElCatalogo ? tiposDeTramite() : Promise.resolve([] as TipoDeTramite[]),
    gestiona ? unidadesParaTramitar() : Promise.resolve([]),
  ])
  const grupos: Record<Vista, Tramite[]> = {
    'en-curso': tramites.filter((t) => ['POR_INICIAR', 'EN_TRAMITE', 'OBSERVADO'].includes(t.situacion)).sort(porPlazo),
    observados: tramites.filter((t) => t.situacion === 'OBSERVADO').sort(porPlazo),
    // El que se cerró último, arriba.
    concluidos: tramites.filter((t) => t.situacion === 'CONCLUIDO').sort((x, y) => (y.concluido_en ?? '').localeCompare(x.concluido_en ?? '')),
    'por-anular': tramites.filter((t) => t.situacion === 'POR_ANULAR'),
    anulados: tramites.filter((t) => t.situacion === 'ANULADO'),
  }
  // Al buscar sin haber elegido vista se abre la primera que tiene resultados:
  // lo concluido es lo que más se busca, y en «En curso» no está.
  const vista: Vista = vistaPedida ?? (busqueda ? VISTAS.find((v) => grupos[v.valor].length > 0)?.valor : undefined) ?? 'en-curso'
  const enOtrasVistas = VISTAS.filter((v) => v.valor !== vista && grupos[v.valor].length > 0).map((v) => `${grupos[v.valor].length} en «${v.titulo}»`)
  const vencidos = grupos['en-curso'].filter((t) => t.vencido).length
  const porResponder = aprueba ? grupos['por-anular'].length : 0
  const alTope =
    tramites.filter((t) => t.situacion !== 'ANULADO' && t.situacion !== 'CONCLUIDO').length >= MAXIMO_VIVOS ||
    grupos.concluidos.length >= MAXIMO_CONCLUIDOS ||
    grupos.anulados.length >= MAXIMO_ANULADOS
  const enUso = tipos.filter((t) => t.activo)

  const resumen = [
    porResponder > 0 ? `${porResponder} ${porResponder === 1 ? 'anulación espera' : 'anulaciones esperan'} tu visto.` : null,
    vencidos > 0 ? `${vencidos} ${vencidos === 1 ? 'trámite pasó' : 'trámites pasaron'} su fecha límite.` : null,
    !gestiona && !aprueba ? 'Solo consulta.' : null,
  ].filter(Boolean)

  return (
    <>
      <EncabezadoPagina
        titulo="Trámites"
        descripcion={resumen.length > 0 ? resumen.join(' ') : undefined}
        ayuda="Los trámites de las unidades de los clientes (tarjeta de propiedad, placas, certificados) y los de la empresa (licencias, SOAT, permisos). Quien lleva los trámites registra cada uno con su número TR y anota en qué va: por iniciar, en trámite u observado por la entidad. En su ficha guarda el expediente (el cargo, los recibos, las gestiones) y lo cierra al subir el documento que entrega la entidad. Un trámite no se borra: se pide su anulación con el motivo y Gerencia la aprueba."
        migas={[{ titulo: 'Trámites' }]}
        acciones={gestiona && enUso.length > 0 && <RegistrarTramite tipos={enUso} unidades={unidades} hoy={hoyLima()} />}
        estado={gestiona ? <EstadoDelTramite /> : undefined}
      />
      {params.archivo === 'fallo' && (
        <AvisoEnfocado rol="alert" className="mb-4">
          Ese archivo no está disponible: pudo retirarse del expediente, o no te corresponde verlo. Si debería abrirse, recarga la ficha del trámite y vuelve a
          tocar «Ver».
        </AvisoEnfocado>
      )}
      <div className="space-y-5">
        <div className="space-y-3">
          <BuscadorSimple ruta="/tramites" clave="buscar" etiqueta="Buscar trámites" marcador="TR, tipo, entidad, expediente, placa, código interno, cliente u OT" />
          <Vistas
            etiqueta="Vista"
            vistas={VISTAS.map((v) => ({
              clave: v.valor,
              titulo: v.titulo,
              // Con búsqueda, «En curso» va con su nombre: sin vista, la búsqueda abre la que tiene resultados.
              href: conBusqueda(v.valor === 'en-curso' && !busqueda ? '/tramites' : `/tramites?vista=${v.valor}`, busqueda),
              activa: vista === v.valor,
              cuenta: grupos[v.valor].length,
            }))}
          />
        </div>
        <Tarjeta className="overflow-hidden">
          <TablaDeTramites
            tramites={grupos[vista]}
            vacio={
              busqueda
                ? enOtrasVistas.length > 0
                  ? { titulo: 'Ninguno en esta vista', descripcion: `Con esa búsqueda hay ${enOtrasVistas.join(', ')}.` }
                  : { titulo: 'Ninguno con esa búsqueda', descripcion: 'Prueba con otro número, tipo, entidad, expediente, placa, código interno, cliente u OT.' }
                : vista === 'en-curso'
                  ? {
                      titulo: 'No hay trámites en curso',
                      descripcion: gestiona
                        ? enUso.length > 0
                          ? 'Toca «Registrar trámite» para guardar el primero.'
                          : 'Ningún tipo de trámite está en uso: agrega uno en «Tipos de trámite» para poder registrar.'
                        : veElCatalogo
                          ? 'Cuando se registre un trámite, aparece aquí.'
                          : 'Aquí salen los trámites de las unidades de los clientes: la tarjeta de propiedad, las placas, los certificados. Cuando se registre uno, aparece aquí.',
                    }
                  : vista === 'observados'
                    ? { titulo: 'Ningún trámite observado', descripcion: 'Cuando una entidad observa un trámite, quien lo lleva lo marca «Observado» con lo que pide subsanar, y sale aquí.' }
                  : vista === 'concluidos'
                    ? { titulo: 'Ningún trámite concluido', descripcion: 'Un trámite se cierra desde su ficha, al subir el documento que entregó la entidad, y sale aquí.' }
                  : vista === 'por-anular'
                    ? { titulo: 'Ningún trámite espera anularse', descripcion: 'La anulación se pide desde la ficha del trámite, con su motivo, y la aprueba Gerencia.' }
                    : { titulo: 'No hay trámites anulados', descripcion: 'Un trámite anulado queda aquí, con su motivo, quién lo pidió y quién lo aprobó.' }
            }
          />
        </Tarjeta>
        {alTope && (
          <p className="text-xs text-texto-suave">
            Se muestran todos los trámites en curso, los {MAXIMO_CONCLUIDOS} concluidos más recientes y los {MAXIMO_ANULADOS} anulados más recientes. Busca para
            encontrar uno más viejo.
          </p>
        )}
        {veElCatalogo && <Catalogo tipos={tipos} gestiona={gestiona} />}
      </div>
    </>
  )
}

function conBusqueda(ruta: string, busqueda: string) {
  if (!busqueda) return ruta
  return `${ruta}${ruta.includes('?') ? '&' : '?'}buscar=${encodeURIComponent(busqueda)}`
}

/** «ABC-123 · M-0045 · Furgón», o «De la empresa». */
const deQuienEs = (t: Tramite) => (t.ambito === 'UNIDAD' ? nombreDeLaUnidad(t) : 'De la empresa')

function TablaDeTramites({ tramites, vacio }: { tramites: Tramite[]; vacio: { titulo: string; descripcion: string } }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Trámite</TH>
          <TH className="hidden md:table-cell">De quién es</TH>
          <TH className="hidden lg:table-cell">Entidad y expediente</TH>
          <TH className="hidden sm:table-cell">Fecha límite</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {tramites.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          tramites.map((t) => <FilaTramite key={t.id} tramite={t} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaTramite({ tramite: t }: { tramite: Tramite }) {
  return (
    <TR data-tramite={t.numero} data-situacion={t.situacion} data-le-toca={t.puede_resolver_anulacion || undefined} data-vencido={t.vencido || undefined}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el número es el único camino a la ficha. */}
          <Link href={`/tramites/${t.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {t.numero}
          </Link>
          {t.puede_resolver_anulacion && <Insignia tono="acento">Te toca</Insignia>}
          <span className="text-xs text-texto-suave">{t.tipo}</span>
        </div>
        <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto">{t.asunto}</p>
        <p className="mt-1 text-sm font-medium text-texto md:hidden">{deQuienEs(t)}</p>
        {t.cliente && <p className="mt-0.5 text-xs text-texto-suave md:hidden">{t.cliente}</p>}
        <p className="mt-1 text-xs text-texto-suave lg:hidden">
          {t.entidad}
          {t.expediente && <span className="tabular"> · Exp. {t.expediente}</span>}
        </p>
        {t.archivos > 0 && (
          <p className="tabular mt-1 flex items-center gap-1 text-xs text-texto-suave" data-archivos={t.archivos}>
            <Paperclip aria-hidden className="size-3.5" />
            {t.archivos} {t.archivos === 1 ? 'archivo' : 'archivos'}
          </p>
        )}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 sm:hidden">
          <Plazo tramite={t} />
          <Situacion tramite={t} />
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{deQuienEs(t)}</p>
        {t.cliente && <p className="max-w-[16rem] text-xs text-texto-suave">{t.cliente}</p>}
        {t.orden_numero && <p className="tabular text-xs text-texto-suave">OT {t.orden_numero}</p>}
      </TD>
      <TD className="hidden align-top lg:table-cell">
        <p className="text-sm text-texto">{t.entidad}</p>
        {t.expediente && <p className="tabular text-xs text-texto-suave">Exp. {t.expediente}</p>}
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Plazo tramite={t} />
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Situacion tramite={t} />
      </TD>
    </TR>
  )
}

/** La fecha límite y cuánto falta, como lo cuenta la base con la fecha de Lima. */
function Plazo({ tramite: t }: { tramite: Tramite }) {
  // Del concluido ya no se cuenta el plazo: en el teléfono, donde no hay
  // cabecera que diga qué es, su fecha límite pasada se leería como un vencimiento.
  const soloConCabecera = t.situacion === 'CONCLUIDO'
  if (!t.fecha_limite) return <p className={cn('text-xs text-texto-suave', soloConCabecera && 'hidden sm:block')}>Sin fecha límite</p>
  const plazo = plazoDelTramite(t.dias_para_limite)
  return (
    <div className={cn('flex-wrap items-center gap-x-2 gap-y-1', soloConCabecera ? 'hidden sm:flex' : 'flex')}>
      <span className="tabular text-sm whitespace-nowrap text-texto">{fecha(t.fecha_limite)}</span>
      {plazo && (
        <Insignia tono={plazo.tono} className="tabular" data-plazo={t.dias_para_limite ?? undefined}>
          {plazo.texto}
        </Insignia>
      )}
    </div>
  )
}

function Situacion({ tramite: t }: { tramite: Tramite }) {
  const s = SITUACION_TRAMITE[t.situacion]
  return (
    <div className="space-y-1">
      {s ? <Insignia tono={s.tono}>{s.etiqueta}</Insignia> : <span className="text-sm text-texto">{t.situacion}</span>}
      {/* Del concluido, lo que importa después: hasta cuándo vale su documento, o de cuándo es. */}
      {t.situacion === 'CONCLUIDO' && (t.vigente_hasta || t.fecha_conclusion) && (
        <p className="tabular text-xs text-texto-suave" data-cierre>
          {t.vigente_hasta ? `Vale hasta el ${fecha(t.vigente_hasta)}` : `Documento del ${fecha(t.fecha_conclusion)}`}
        </p>
      )}
    </div>
  )
}

/**
 * El catálogo de tipos, al final: se toca poco. Quien lleva los trámites lo
 * amplía y lo corrige; Gerencia y Administración lo consultan.
 */
function Catalogo({ tipos, gestiona }: { tipos: TipoDeTramite[]; gestiona: boolean }) {
  return (
    <SeccionDesplegable
      id="tipos-de-tramite"
      titulo={`Tipos de trámite · ${tipos.filter((t) => t.activo).length}`}
      descripcion="Qué trámites se llevan, ante qué entidad y con cuántos días de anticipación se avisa su vencimiento."
      className="scroll-mt-24"
    >
      <div className="space-y-4">
        {gestiona && (
          <div className="flex flex-wrap items-center gap-3">
            <GuardarTipo />
            <AvisoDelCatalogo />
          </div>
        )}
        {AMBITOS_TRAMITE.map((ambito) => {
          const delAmbito = tipos.filter((t) => t.ambito === ambito)
          if (delAmbito.length === 0) return null
          return (
            <section key={ambito} aria-label={AMBITO_TRAMITE[ambito].etiqueta}>
              <h3 className="text-xs font-semibold tracking-wide text-texto-suave uppercase">{AMBITO_TRAMITE[ambito].etiqueta}</h3>
              <ul className="mt-1 divide-y divide-borde">
                {delAmbito.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-x-4 py-2" data-tipo={t.nombre} data-activo={t.activo}>
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-texto">
                        {t.nombre}
                        {t.se_renueva && <Insignia tono="info">Se renueva</Insignia>}
                        {!t.activo && <Insignia>Fuera de uso</Insignia>}
                      </p>
                      <p className="mt-0.5 text-xs text-texto-suave">
                        {t.entidad} · Aviso: <span className="tabular">{diasDeAvisoEnTexto(t.dias_aviso).toLowerCase()}</span>
                      </p>
                    </div>
                    {gestiona && (
                      <div className="shrink-0">
                        <GuardarTipo tipo={t} />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </SeccionDesplegable>
  )
}
