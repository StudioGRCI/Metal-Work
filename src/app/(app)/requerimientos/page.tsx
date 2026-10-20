import Link from 'next/link'

import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { SinDatos } from '@/components/ui/tabla'
import { Tarjeta } from '@/components/ui/tarjeta'
import { correccionesDe } from '@/lib/datos/correcciones'
import { cargarRequerimientos, catalogosDelRequerimiento } from '@/lib/datos/requerimientos'
import { TIPO_REQUERIMIENTO, type TipoRequerimiento } from '@/lib/dominio/requerimientos'
import { exigirPermiso, puede } from '@/lib/sesion'
import { esUuid } from '@/lib/utils'

import { NuevoRequerimiento } from './formulario'
import { ResumenDeRequerimientos, TarjetaRequerimiento, tieneParaRecoger } from './tarjeta'

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
    'requerimientos.ver',
    'compras.crear',
    'almacen.recibir',
  ])
  // Cada requerimiento lo lleva su dueño: el de operación, Requerimientos; el
  // de Administración, la administradora (migración 20261015162000).
  const tipos: TipoRequerimiento[] = [
    ...(puede(perfil, 'requerimientos.emitir') ? (['OPERACION'] as const) : []),
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
  // El supervisor de área ve primero los RQ de su área, como en su dashboard;
  // `?area=todas` muestra los de todas. Los de Administración no son de ningún taller.
  const supervisaArea = perfil.rol.codigo === 'SUPERVISOR' && perfil.area_id !== null
  const deSuArea = supervisaArea && params.area !== 'todas' ? (perfil.area_id ?? undefined) : undefined
  const [requerimientos, catalogos] = await Promise.all([
    cargarRequerimientos(
      soloUno
        ? { id: soloUno, conEntregado: true }
        : { tipo: supervisaArea || vista === 'todos' ? undefined : vista, area: deSuArea, codigo, conEntregado: true },
    ),
    emite ? catalogosDelRequerimiento() : Promise.resolve(null),
  ])
  // `?ver=recoger` deja solo los que tienen algo para recoger en Almacén: es la
  // cifra verde de arriba. Las cifras siguen contando todos.
  const soloRecoger = !soloUno && params.ver === 'recoger'
  const mostrados = soloRecoger ? requerimientos.filter(tieneParaRecoger) : requerimientos
  const correcciones = await correccionesDe('REQUERIMIENTO', mostrados.map((r) => r.id))
  // La dirección de esta misma lista, sin el filtro de recoger: para quitarlo y para ponerlo.
  const filtros = new URLSearchParams()
  if (pedida) filtros.set('tipo', pedida)
  if (supervisaArea && !deSuArea) filtros.set('area', 'todas')
  if (codigo) filtros.set('codigo', codigo)
  const sinRecoger = `/requerimientos${filtros.size > 0 ? `?${filtros}` : ''}`
  filtros.set('ver', 'recoger')
  const conRecoger = `/requerimientos?${filtros}`
  const verTodos = supervisaArea && !deSuArea ? '/requerimientos?area=todas' : '/requerimientos'
  const vacio = listaVacia({ soloRecoger, codigo, deSuArea: Boolean(deSuArea), emite, sinRecoger, verTodos })

  return (
    <>
      <EncabezadoPagina
        titulo="Requerimientos"
        ayuda={
          emite
            ? 'Lo que cada área necesita, con el código interno y su justificación. Al registrarlo lo revisa Almacén insumo por insumo: lo que tiene lo separa y solo lo que falta se compra. La barra de cada insumo dice cuánto ya se puede recoger en Almacén (verde) y cuánto falta que llegue. El «Avance %» de cada RQ va por la etapa de su insumo más atrasado, no por lo recibido.'
            : supervisaArea
              ? 'Lo que pidió tu área, y con «Todas las áreas» lo de las demás. La barra de cada insumo dice cuánto ya puedes recoger en Almacén (verde), cuánto falta que traiga Logística y en qué va, y cuánto ya se entregó. El código interno muestra solo los RQ de esa unidad. El «Avance %» de cada RQ va por la etapa de su insumo más atrasado, no por lo recibido.'
              : 'Los requerimientos de operación y de Administración. La barra de cada insumo dice cuánto ya se puede recoger en Almacén (verde), cuánto falta que llegue y en qué va, y cuánto ya se entregó. El «Avance %» de cada RQ va por la etapa de su insumo más atrasado, no por lo recibido.'
        }
        migas={[{ titulo: 'Requerimientos' }]}
        acciones={catalogos && <NuevoRequerimiento {...catalogos} tipos={tipos} />}
      />

      <Vistas
        etiqueta="Requerimiento"
        className="mb-3"
        vistas={(supervisaArea
          ? [
              { clave: 'mia', titulo: 'De tu área', href: '/requerimientos', activa: Boolean(deSuArea), descripcion: undefined },
              { clave: 'todas', titulo: 'Todas las áreas', href: '/requerimientos?area=todas', activa: !deSuArea, descripcion: undefined },
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
          href: codigo ? `${v.href}${v.href.includes('?') ? '&' : '?'}codigo=${encodeURIComponent(codigo)}` : v.href,
          activa: !soloUno && v.activa,
          cuenta: !soloUno && v.activa ? mostrados.length : undefined,
        }))}
      />

      {!soloUno && codigo && (
        <p className="mb-3 text-sm text-texto-suave">
          Solo los del código interno <span className="font-mono text-texto">{codigo}</span>.{' '}
          <Link href={verTodos} className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {soloUno && (
        <p className="mb-3 text-sm text-texto-suave">
          {requerimientos.length === 1 ? `Solo el ${requerimientos[0].numero}.` : 'Ese requerimiento no está o no lo puedes ver.'}{' '}
          <Link href="/requerimientos" className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {soloRecoger && (
        <p className="mb-3 text-sm text-texto-suave">
          Solo los que tienen algo para recoger en Almacén.{' '}
          <Link href={sinRecoger} className="font-medium text-acento hover:underline">
            Ver todos
          </Link>
        </p>
      )}

      {!soloUno && requerimientos.length > 0 && <ResumenDeRequerimientos requerimientos={requerimientos} enlaceRecoger={soloRecoger ? null : conRecoger} />}

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
              insumosAbiertos={Boolean(soloUno) || (r.estado !== 'ENTREGADO' && r.estado !== 'ANULADO')}
              enlaceCodigo={supervisaArea && !deSuArea ? '/requerimientos?area=todas&codigo=' : '/requerimientos?codigo='}
              anula={tipos.includes(r.tipo as TipoRequerimiento)}
              materiales={catalogos?.materiales ?? []}
              codigos={catalogos?.codigos ?? null}
              correcciones={correcciones.get(r.id)}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * Qué decir cuando la lista sale vacía: con un filtro puesto no es que no haya
 * requerimientos, es que ese filtro no trae ninguno, y se dice cómo quitarlo.
 */
function listaVacia({
  soloRecoger,
  codigo,
  deSuArea,
  emite,
  sinRecoger,
  verTodos,
}: {
  soloRecoger: boolean
  codigo: string | undefined
  deSuArea: boolean
  emite: boolean
  sinRecoger: string
  /** La lista sin el código: la del área, o la de todas si se miraban todas. */
  verTodos: string
}): { titulo: string; descripcion: string; accion?: React.ReactNode } {
  const enlace = (href: string, texto: string) => (
    <Link href={href} className="text-sm font-medium text-acento hover:underline">
      {texto}
    </Link>
  )
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
