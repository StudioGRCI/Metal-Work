import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { PastillaFiltro } from '@/components/estructura/pastilla-filtro'
import { Vistas } from '@/components/estructura/vistas'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { correccionesDe } from '@/lib/datos/correcciones'
import { conformidadDeRequerimientos } from '@/lib/datos/conformidad'
import { metradoDeRequerimientos } from '@/lib/datos/metrado-rq'
import { recorridoDeRequerimientos } from '@/lib/datos/recorrido'
import { PERMISO_OTS_DE_MANTENIMIENTO } from '@/lib/dominio/mantenimiento'
import { esperaSuSustento } from '@/lib/dominio/metrado-rq'
import { esFiltroDePlazo, fechasDelFiltro, FILTROS_DE_PLAZO, type FiltroDePlazo } from '@/lib/dominio/plazo-rq'
import { describirRecorridoDelRequerimiento } from '@/lib/dominio/recorrido'
import { cargarRequerimientos, catalogosDelRequerimiento, contarRequerimientosAbiertos } from '@/lib/datos/requerimientos'
import { normalizarCodigo } from '@/lib/dominio/codigos-internos'
import { CODIGO_DEL_GASTO_OPERATIVO, tieneParaRecoger, TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { hoyLima } from '@/lib/format'
import { exigirPermiso, puede } from '@/lib/sesion'
import { esUuid } from '@/lib/utils'

import { NuevoRequerimiento } from './formulario'
import { ResumenDeRequerimientos, TarjetaRequerimiento, tieneNotaAbierta } from './tarjeta'

export const metadata = { title: 'Requerimientos' }

const VISTAS = [
  { valor: 'todos', titulo: 'Todos' },
  { valor: 'OPERACION', titulo: 'Operación' },
  { valor: 'ADMINISTRACION', titulo: 'Administración' },
] as const

export default async function PaginaRequerimientos({ searchParams }: PageProps<'/requerimientos'>) {
  const perfil = await exigirPermiso([
    'requerimientos.emitir',
    'requerimientos.administracion',
    'requerimientos.area',
    'requerimientos.ver',
    'compras.crear',
    'almacen.recibir',
  ])
  // Cada requerimiento lo lleva su dueño: el de operación, Requerimientos; el
  // de Administración, la administradora (migración 20261015162000). El
  // supervisor registra el de operación de su propia área (20261120300000).
  const soloSuArea = !puede(perfil, 'requerimientos.emitir') && puede(perfil, 'requerimientos.area')
  const pideSuArea = soloSuArea && perfil.area_id !== null
  // Mantenimiento pide por el N.º de la OT de mantenimiento, no por unidad de
  // fabricación (plan «Las demás áreas», A.3): su primera pestaña es su lista
  // de OT, y aquí ve solo lo de su área.
  const porOt = pideSuArea && puede(perfil, PERMISO_OTS_DE_MANTENIMIENTO)
  const tipos: TipoRequerimiento[] = [
    ...(puede(perfil, 'requerimientos.emitir') || pideSuArea ? (['OPERACION'] as const) : []),
    ...(puede(perfil, 'requerimientos.administracion') ? (['ADMINISTRACION'] as const) : []),
  ]
  const emite = tipos.length > 0
  // Quien lleva uno solo abre en el suyo; los demás, en todos.
  const params = await searchParams
  const pedida = VISTAS.find((v) => v.valor === params.tipo)?.valor
  const vista = pedida ?? (tipos.length === 1 ? tipos[0] : 'todos')
  // `?rq=` muestra un solo RQ: es el enlace con que Adquisiciones abre el RQ de cada OC.
  const soloUno = typeof params.rq === 'string' && esUuid(params.rq) ? params.rq : undefined
  // `?codigo=` muestra los RQ de un código interno: el que se presiona en cada fila.
  const codigo = typeof params.codigo === 'string' && params.codigo.trim().length >= 2 ? params.codigo.trim().slice(0, 60) : undefined
  // Con PLANTA, `?gasto=area` deja el gasto operativo del área y `?gasto=antes`
  // los de PLANTA de antes de esa opción: la tarjeta de «RQ por unidad» los separa.
  const gasto = codigo && normalizarCodigo(codigo) === CODIGO_DEL_GASTO_OPERATIVO && (params.gasto === 'area' || params.gasto === 'antes')
    ? params.gasto
    : undefined
  // El supervisor de área ve primero los RQ de su área, como en su dashboard;
  // `?area=todas` muestra los de todas. Los de Administración no son de ningún taller.
  // Mantenimiento, lo mismo, sin «Todas las áreas»: las demás no son lo suyo.
  const supervisaArea = (perfil.rol.codigo === 'SUPERVISOR' || porOt) && perfil.area_id !== null
  const deSuArea = supervisaArea && (porOt || params.area !== 'todas') ? (perfil.area_id ?? undefined) : undefined
  // `?plazo=` deja los RQ en camino que se necesitan de hoy al domingo, o los
  // vencidos (plan 3, entrega 3.1). Los pide a la base por su fecha, con los
  // demás filtros (tipo, área, código): con la lista de los 300 más nuevos los
  // vencidos más viejos quedaban fuera. No se suma a «para recoger» ni a «esperan
  // tu sustento»: son otra pregunta, y sus cifras no contarían lo que se ve.
  const plazo = !soloUno && esFiltroDePlazo(params.plazo) ? params.plazo : null
  const hoy = hoyLima()
  const filtrosDeLista = { tipo: supervisaArea || vista === 'todos' ? undefined : vista, area: deSuArea, codigo, paraElArea: gasto ? gasto === 'area' : undefined } as const
  const [requerimientos, catalogos, enPlazo, cuentasDePlazo] = await Promise.all([
    cargarRequerimientos(soloUno ? { id: soloUno, conEntregado: true } : { ...filtrosDeLista, conEntregado: true }),
    emite ? catalogosDelRequerimiento() : Promise.resolve(null),
    plazo
      ? cargarRequerimientos({
          ...filtrosDeLista,
          soloAbiertos: true,
          conEntregado: true,
          necesitadoDesde: fechasDelFiltro(plazo, hoy).desde,
          necesitadoHasta: fechasDelFiltro(plazo, hoy).hasta,
        })
      : Promise.resolve(null),
    // Las cifras de las pastillas, contadas por la base con los mismos filtros.
    soloUno
      ? Promise.resolve(null)
      : Promise.all(
          (Object.keys(FILTROS_DE_PLAZO) as FiltroDePlazo[]).map(async (f) => {
            const { desde, hasta } = fechasDelFiltro(f, hoy)
            return [f, await contarRequerimientosAbiertos({ ...filtrosDeLista, necesitadoDesde: desde, necesitadoHasta: hasta })] as const
          }),
        ).then((cuentas) => new Map(cuentas)),
  ])
  // `?ver=recoger` deja solo los que tienen algo para recoger en Almacén: es la
  // cifra verde de arriba. Las cifras siguen contando todos.
  const soloRecoger = !soloUno && !plazo && params.ver === 'recoger'
  const recogen = enPlazo ?? (soloRecoger ? requerimientos.filter(tieneParaRecoger) : requerimientos)
  // Cómo va cada insumo del RQ de Administración, de principio a fin (plan 8,
  // entrega 8.3), para quien lo lleva.
  const llevaElRqa = puede(perfil, 'requerimientos.administracion')
  const [correcciones, metrado, recorridos, conformidad] = await Promise.all([
    correccionesDe('REQUERIMIENTO', recogen.map((r) => r.id)),
    // De todos, no solo de los mostrados: las cifras de arriba y «esperan tu sustento» los cuentan.
    // Sin el metrado, la tarjeta sigue: solo no dice qué insumo se pasa, y arriba se avisa.
    metradoDeRequerimientos([...new Set([...requerimientos, ...(enPlazo ?? [])].map((r) => r.id))]).catch((e: unknown) => {
      console.error('Requerimientos: no se pudo leer el metrado de Diseño.', e)
      return null
    }),
    // Sin el recorrido, la tarjeta sigue con todo lo demás y lo dice en su lugar.
    recorridoDeRequerimientos(recogen.map((r) => r.id)).catch((e: unknown) => {
      console.error('Requerimientos: no se pudo leer el recorrido.', e)
      return null
    }),
    // Las salidas de cada insumo con su foto y lo que quien pidió anotó de ellas
    // (plan 2, entrega 2.2). Sin ellas, la tarjeta sigue y lo dice en su lugar.
    conformidadDeRequerimientos(recogen.map((r) => r.id)).catch((e: unknown) => {
      console.error('Requerimientos: no se pudieron leer las salidas.', e)
      return null
    }),
  ])
  // El supervisor pide para su área y nada más: el formulario no le ofrece otra.
  const areaFija = pideSuArea ? catalogos?.areas.find((a) => a.id === perfil.area_id && a.requerimiento === 'OPERACION') : undefined
  // Lo corrige, lo sustenta y lo anula quien lleva su tipo; el supervisor, solo los que registró él.
  const loLleva = (r: (typeof requerimientos)[number]) =>
    pideSuArea ? r.tipo === 'OPERACION' && r.creado_por === perfil.id : tipos.includes(r.tipo as TipoRequerimiento)
  // `?ver=sustentar` deja solo los que esperan el sustento de quien mira: es el
  // enlace del pendiente «se pasa del metrado y espera tu sustento».
  // El colaborador de Diseño corrige, sustenta y anula solo los que registró él (migración 20261106100000).
  const esSuyo = (r: (typeof requerimientos)[number]) => loLleva(r) && (perfil.rol.codigo !== 'DISENO_COLABORADOR' || r.creado_por === perfil.id)
  const porSustentar = metrado ? requerimientos.filter((r) => esSuyo(r) && esperaSuSustento(r, metrado)) : []
  const soloSustentar = !soloUno && !plazo && !soloRecoger && params.ver === 'sustentar'
  const mostrados = soloSustentar ? porSustentar : recogen
  // La dirección de esta misma lista, sin el filtro de recoger ni el de la fecha: para quitarlos y para ponerlos.
  const filtros = new URLSearchParams()
  if (pedida) filtros.set('tipo', pedida)
  if (supervisaArea && !deSuArea) filtros.set('area', 'todas')
  if (codigo) filtros.set('codigo', codigo)
  if (gasto) filtros.set('gasto', gasto)
  const sinRecoger = `/requerimientos${filtros.size > 0 ? `?${filtros}` : ''}`
  filtros.set('ver', 'sustentar')
  const conSustentar = `/requerimientos?${filtros}`
  filtros.set('ver', 'recoger')
  const conRecoger = `/requerimientos?${filtros}`
  const verTodos = supervisaArea && !deSuArea ? '/requerimientos?area=todas' : '/requerimientos'
  const vacio = listaVacia({ plazo, soloRecoger, soloSustentar, codigo, deSuArea: Boolean(deSuArea), emite, pideSuArea, porOt, sinRecoger, verTodos })
  // Las pestañas y el «Ver todos» del código conservan la fecha elegida.
  const conPlazo = (href: string) => (plazo ? `${href}${href.includes('?') ? '&' : '?'}plazo=${plazo}` : href)
  // La pastilla de la fecha quita «para recoger» y «esperan tu sustento»: no se suman.
  const { ver: _ver, ...sinVer } = params

  return (
    <>
      <EncabezadoPagina
        titulo="Requerimientos"
        ayuda={
          porOt
            ? 'Lo que pidió tu área. Pide los materiales de cada OT de mantenimiento desde «Por OT», con su número ya puesto, o aquí con «Nuevo requerimiento». La barra de cada insumo dice cuánto ya puedes recoger en Almacén (verde), cuánto falta que traiga Logística y en qué va, y cuánto ya se entregó. Corriges y anulas solo los que registraste tú.'
            : pideSuArea
            ? 'Lo que pidió tu área, y con «Todas las áreas» lo de las demás. Registra el requerimiento de cada unidad desde «Por unidad», o aquí con «Nuevo requerimiento». La materia prima y los accesorios de una unidad se comparan con el metrado de Diseño de su código, si Diseño ya lo cargó: lo que se pasa necesita tu sustento y el visto de Diseño antes de que Almacén lo revise. La barra de cada insumo dice cuánto ya puedes recoger en Almacén (verde), cuánto falta que traiga Logística y en qué va, y cuánto ya se entregó. Corriges, sustentas y anulas solo los que registraste tú.'
            : emite
            ? 'Lo que cada área necesita, con el código interno y su justificación. La materia prima y los accesorios de una unidad se comparan con el metrado de Diseño de su código, si Diseño ya lo cargó: lo que se pasa necesita tu sustento y el visto de Diseño antes de que Almacén lo revise. Almacén lo revisa insumo por insumo: lo que tiene lo separa y solo lo que falta se compra. La barra de cada insumo dice cuánto ya se puede recoger en Almacén (verde) y cuánto falta que llegue. El «Avance %» de cada RQ es el promedio de las etapas de sus insumos, no lo recibido.'
            : supervisaArea
              ? 'Lo que pidió tu área, y con «Todas las áreas» lo de las demás. La barra de cada insumo dice cuánto ya puedes recoger en Almacén (verde), cuánto falta que traiga Logística y en qué va, y cuánto ya se entregó. El código interno muestra solo los RQ de esa unidad. El «Avance %» de cada RQ es el promedio de las etapas de sus insumos, no lo recibido.'
              : 'Los requerimientos de operación y de Administración. La barra de cada insumo dice cuánto ya se puede recoger en Almacén (verde), cuánto falta que llegue y en qué va, y cuánto ya se entregó. El «Avance %» de cada RQ es el promedio de las etapas de sus insumos, no lo recibido.'
        }
        migas={[{ titulo: 'Requerimientos' }]}
        acciones={
          // Sin un área que pida por el RQ de operación, el supervisor no tiene
          // para quién pedir: la base le rechazaría cualquier otra.
          catalogos && !(pideSuArea && !areaFija) && <NuevoRequerimiento {...catalogos} tipos={tipos} areaFija={areaFija} />
        }
      />

      {/* 20 px entre bloques, como dice la escala de la skill diseno (iban a 12).
          Las tarjetas de la lista siguen a 12: son filas de una misma lista. */}
      <div className="space-y-5">
      <Vistas
        etiqueta="Requerimiento"
        vistas={(supervisaArea
          ? [
              ...(porOt
                ? [{ clave: 'unidades', titulo: 'Por OT', href: '/mantenimiento', activa: false, descripcion: 'Las OT de mantenimiento, para pedir por cada una' }]
                : pideSuArea
                  ? [{ clave: 'unidades', titulo: 'Por unidad', href: '/requerimientos/unidades', activa: false, descripcion: 'Las unidades de tu área, para pedir por cada una' }]
                  : []),
              { clave: 'mia', titulo: 'De tu área', href: '/requerimientos', activa: Boolean(deSuArea), descripcion: undefined },
              ...(porOt
                ? []
                : [{ clave: 'todas', titulo: 'Todas las áreas', href: '/requerimientos?area=todas', activa: !deSuArea, descripcion: undefined }]),
            ]
          : VISTAS.map((v) => ({
              clave: v.valor,
              titulo: v.titulo,
              href: `/requerimientos?tipo=${v.valor}`,
              activa: vista === v.valor,
              descripcion: v.valor === 'todos' ? undefined : TIPO_REQUERIMIENTO[v.valor]?.descripcion,
            }))
        ).map((v) => ({
          ...v,
          href:
            v.clave === 'unidades'
              ? v.href
              : conPlazo(codigo ? `${v.href}${v.href.includes('?') ? '&' : '?'}codigo=${encodeURIComponent(codigo)}` : v.href),
          activa: !soloUno && v.activa,
          cuenta: !soloUno && v.activa ? mostrados.length : undefined,
        }))}
      />

      {!soloUno && codigo && (
        <p className="text-sm text-texto-suave">
          {gasto === 'area' ? (
            <>Solo el gasto operativo del área (<span className="font-mono text-texto">{codigo}</span>).{' '}</>
          ) : gasto === 'antes' ? (
            <>Solo los pedidos con <span className="font-mono text-texto">{codigo}</span> antes del 27/11: no son gasto operativo.{' '}</>
          ) : (
            <>Solo los del código interno <span className="font-mono text-texto">{codigo}</span>.{' '}</>
          )}
          <Link href={conPlazo(verTodos)} className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {soloUno && (
        <p className="text-sm text-texto-suave">
          {requerimientos.length === 1 ? `Solo el ${requerimientos[0].numero}.` : 'Ese requerimiento no está o no lo puedes ver.'}{' '}
          <Link href="/requerimientos" className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {metrado === null && requerimientos.length > 0 && (
        <p role="status" className="rounded-[var(--radius-base)] border border-aviso bg-aviso-suave px-3 py-2 text-sm text-texto" data-metrado-sin-leer>
          No se pudo leer el metrado de Diseño: las tarjetas no dicen qué insumo se pasa ni cuál espera tu sustento. Vuelve a cargar la
          pantalla en un momento.
        </p>
      )}

      {!soloUno && !soloSustentar && porSustentar.length > 0 && (
        <p className="rounded-[var(--radius-base)] border border-peligro bg-peligro-suave px-3 py-2 text-sm text-texto" data-esperan-sustento>
          {porSustentar.length === 1
            ? `El ${porSustentar[0].numero} se pasa del metrado de Diseño y espera tu sustento.`
            : `${porSustentar.length} requerimientos se pasan del metrado de Diseño y esperan tu sustento.`}{' '}
          <Link href={conSustentar} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
            {porSustentar.length === 1 ? 'Ver solo ese' : 'Ver solo esos'}
          </Link>
        </p>
      )}

      {soloSustentar && (
        <p className="text-sm text-texto-suave">
          Solo los que se pasan del metrado y esperan tu sustento.{' '}
          <Link href={sinRecoger} className="inline-flex min-h-11 items-center font-medium text-acento hover:underline sm:min-h-0">
            Ver todos
          </Link>
        </p>
      )}

      {soloRecoger && (
        <p className="text-sm text-texto-suave">
          Solo los que tienen algo para recoger en Almacén.{' '}
          <Link href={sinRecoger} className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {!soloUno && requerimientos.length > 0 && <ResumenDeRequerimientos requerimientos={requerimientos} enlaceRecoger={soloRecoger ? null : conRecoger} metrado={metrado} />}

      {!soloUno && requerimientos.length > 0 && (
        <PastillaFiltro
          etiqueta="Por la fecha en que se necesita"
          className="mb-3"
          ruta="/requerimientos"
          clave="plazo"
          params={sinVer}
          activo={plazo}
          opciones={[
            { valor: null, etiqueta: 'Cualquier fecha' },
            ...(Object.keys(FILTROS_DE_PLAZO) as FiltroDePlazo[]).map((f) => ({
              valor: f,
              etiqueta: cuentasDePlazo ? `${FILTROS_DE_PLAZO[f]} (${cuentasDePlazo.get(f) ?? 0})` : FILTROS_DE_PLAZO[f],
            })),
          ]}
        />
      )}

      {mostrados.length === 0 ? (
        !soloUno && (
          <Tarjeta>
            <SinDatos enTabla={false} titulo={vacio.titulo} descripcion={vacio.descripcion} accion={vacio.accion} />
          </Tarjeta>
        )
      ) : (
        <div className="space-y-3">
          {mostrados.map((r) => (
            <TarjetaRequerimiento
              key={r.id}
              rq={r}
              // Lo que va en camino se ve desplegado, para ver de un vistazo qué
              // se recoge y qué falta; lo entregado y lo anulado, al presionar.
              // Lo entregado también, si una salida tiene una nota que Almacén no cerró.
              insumosAbiertos={
                Boolean(soloUno) || (r.estado !== 'ENTREGADO' && r.estado !== 'ANULADO') || Boolean(conformidad && tieneNotaAbierta(r, conformidad))
              }
              enlaceCodigo={supervisaArea && !deSuArea ? '/requerimientos?area=todas&codigo=' : '/requerimientos?codigo='}
              // El colaborador de Diseño solo pide: corrige y anula los suyos (migración 20261106100000).
              anula={esSuyo(r)}
              materiales={catalogos?.materiales ?? []}
              codigos={catalogos?.codigos ?? null}
              correcciones={correcciones.get(r.id)}
              metrado={metrado}
              recorrido={recorridos ? describirRecorridoDelRequerimiento(recorridos.get(r.id) ?? []) : null}
              conformidad={conformidad}
              pasosPorInsumo={llevaElRqa && r.tipo === 'ADMINISTRACION'}
            />
          ))}
        </div>
      )}
      </div>
    </>
  )
}

/**
 * Qué decir cuando la lista sale vacía: con un filtro puesto no es que no haya
 * requerimientos, es que ese filtro no trae ninguno, y se dice cómo quitarlo.
 */
function listaVacia({
  plazo,
  soloRecoger,
  soloSustentar,
  codigo,
  deSuArea,
  emite,
  pideSuArea,
  porOt,
  sinRecoger,
  verTodos,
}: {
  /** El filtro por la fecha en que se necesita, si hay uno puesto. */
  plazo: FiltroDePlazo | null
  soloRecoger: boolean
  soloSustentar: boolean
  codigo: string | undefined
  deSuArea: boolean
  emite: boolean
  /** El supervisor que pide para su área: lo invita a pedir por unidad. */
  pideSuArea: boolean
  /** Mantenimiento: pide por el N.º de su OT, desde su lista de OT. */
  porOt: boolean
  sinRecoger: string
  /** La lista sin el código: la del área, o la de todas si se miraban todas. */
  verTodos: string
}): { titulo: string; descripcion: string; accion?: React.ReactNode } {
  const enlace = (href: string, texto: string) => (
    <Link href={href} className="inline-flex min-h-11 items-center text-sm font-medium text-acento hover:underline sm:min-h-0">
      {texto}
    </Link>
  )
  if (plazo) {
    // Quita solo este filtro: los demás (el tipo, el área, el código) siguen puestos.
    return {
      titulo: plazo === 'vencidos' ? 'Ninguno vencido sin entregar' : 'Ninguno se necesita esta semana',
      descripcion:
        plazo === 'vencidos'
          ? `Ningún requerimiento en camino${deSuArea ? ' de tu área' : ''} tiene su fecha vencida.`
          : `Ningún requerimiento en camino${deSuArea ? ' de tu área' : ''} se necesita entre hoy y el domingo.`,
      accion: enlace(sinRecoger, 'Ver de cualquier fecha'),
    }
  }
  if (soloSustentar) {
    return {
      titulo: 'Ninguno espera tu sustento',
      descripcion: 'Lo que pediste entra en el metrado de Diseño, o ya lo sustentaste y lo tiene Diseño.',
      accion: enlace(sinRecoger, 'Ver todos'),
    }
  }
  if (soloRecoger) {
    return {
      titulo: 'Nada para recoger en Almacén todavía',
      descripcion: 'Cuando Almacén tenga algo de lo pedido, el requerimiento aparece aquí.',
      accion: enlace(sinRecoger, 'Ver todos'),
    }
  }
  if (codigo) {
    return {
      titulo: `Ningún requerimiento con el código ${codigo}`,
      descripcion: 'Revisa el código o mira todos los requerimientos.',
      accion: enlace(verTodos, 'Ver todos'),
    }
  }
  if (deSuArea && porOt) {
    return {
      titulo: 'Tu área todavía no tiene requerimientos',
      descripcion: 'Pide los materiales de cada OT de mantenimiento desde «Por OT», con su número ya puesto.',
      accion: enlace('/mantenimiento', 'Pedir por OT'),
    }
  }
  if (deSuArea && pideSuArea) {
    return {
      titulo: 'Tu área todavía no tiene requerimientos',
      descripcion: 'Pide el material de cada unidad desde «Por unidad», con el código ya puesto. Los de las demás áreas están en «Todas las áreas».',
      accion: enlace('/requerimientos/unidades', 'Pedir por unidad'),
    }
  }
  if (deSuArea) {
    return {
      titulo: 'Tu área todavía no tiene requerimientos',
      descripcion: 'Los de las demás áreas están en «Todas las áreas».',
      accion: enlace('/requerimientos?area=todas', 'Ver todas las áreas'),
    }
  }
  return {
    titulo: 'Todavía no hay requerimientos',
    descripcion: emite ? 'Registra el primero con «Nuevo requerimiento».' : 'Requerimientos y la administradora los registran; aparecen aquí con su número.',
  }
}
