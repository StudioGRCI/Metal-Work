import { Camera } from 'lucide-react'
import Link from 'next/link'

import { BuscadorSimple } from '@/components/estructura/buscador-simple'
import { EncabezadoPagina } from '@/components/estructura/encabezado-pagina'
import { Vistas } from '@/components/estructura/vistas'
import { Insignia } from '@/components/ui/etiqueta-estado'
import { SinDatos, TD, TH, TR, Tabla, TablaCabecera } from '@/components/ui/tabla'
import { Tarjeta, TarjetaCabecera } from '@/components/ui/tarjeta'
import { listarInspecciones, loQueSeInspecciona, MAXIMO_ABIERTAS, MAXIMO_INSPECCIONES, type InspeccionCalidad } from '@/lib/datos/calidad'
import { diasAbierta, ESTADO_INSPECCION, ESTADOS_ABIERTOS } from '@/lib/dominio/calidad'
import { fechaHora } from '@/lib/format'
import { exigirSesion, puede } from '@/lib/sesion'

import { EstadoDeLaInspeccion, RegistrarInspeccion } from './formulario'

export const metadata = { title: 'Calidad: inspecciones' }

const VISTAS = [
  { valor: 'abiertas', titulo: 'Abiertas' },
  { valor: 'vigentes', titulo: 'Vigentes' },
  { valor: 'anuladas', titulo: 'Anuladas' },
] as const
type Vista = (typeof VISTAS)[number]['valor']

const abierta = (i: InspeccionCalidad) => (ESTADOS_ABIERTOS as readonly string[]).includes(i.estado)

/**
 * Las inspecciones de calidad. Calidad registra y lleva todas; Gerencia las
 * consulta; cada área ve las suyas y marca lo que corrigió. Qué ve cada quien lo
 * decide la base (`calidad_inspecciones_visibles`).
 */
export default async function PaginaCalidad({ searchParams }: PageProps<'/calidad'>) {
  const perfil = await exigirSesion()
  // El mismo permiso que pide `calidad_inspeccionar`.
  const inspecciona = puede(perfil, 'calidad.inspeccionar')
  const veTodo = inspecciona || puede(perfil, 'calidad.ver')
  const params = await searchParams
  const pedida = typeof params.vista === 'string' ? params.vista : ''
  const vista: Vista = VISTAS.some((v) => v.valor === pedida) ? (pedida as Vista) : 'abiertas'
  const busqueda = typeof params.codigo === 'string' ? params.codigo.trim() : ''

  const [inspecciones, paraRegistrar] = await Promise.all([
    listarInspecciones(busqueda),
    inspecciona ? loQueSeInspecciona() : Promise.resolve(null),
  ])
  // Las abiertas van todas; el tope es de las que ya quedaron.
  const alTope =
    inspecciones.filter((i) => !abierta(i)).length >= MAXIMO_INSPECCIONES || inspecciones.filter(abierta).length >= MAXIMO_ABIERTAS

  if (veTodo) {
    const vigentes = inspecciones.filter((i) => i.estado !== 'ANULADA')
    const grupos: Record<Vista, InspeccionCalidad[]> = {
      abiertas: vigentes.filter(abierta),
      vigentes,
      anuladas: inspecciones.filter((i) => i.estado === 'ANULADA'),
    }
    const porRevisar = grupos.abiertas.filter((i) => i.estado === 'CORREGIDA').length
    return (
      <>
        <EncabezadoPagina
          titulo="Inspecciones de calidad"
          descripcion={
            inspecciona
              ? porRevisar > 0
                ? `${porRevisar} ${porRevisar === 1 ? 'corrección espera' : 'correcciones esperan'} tu revisión.`
                : undefined
              : 'Solo consulta.'
          }
          ayuda="Calidad elige el código interno y la etapa, marca conforme o no conforme y, si hace falta, pone fotos. Lo no conforme le llega a la cuenta responsable del área (o a sus cuentas, si no tiene); el área lo marca corregido y Calidad lo levanta o lo vuelve a observar. No detiene la etapa siguiente. Una inspección no se borra: si está mal, Calidad la anula con su motivo."
          migas={[{ titulo: 'Calidad' }]}
          acciones={
            paraRegistrar && <RegistrarInspeccion cuentaId={perfil.id} codigos={paraRegistrar.codigos} etapas={paraRegistrar.etapas} areas={paraRegistrar.areas} />
          }
          estado={inspecciona ? <EstadoDeLaInspeccion /> : undefined}
        />
        <div className="mb-3 space-y-3">
          <BuscadorSimple ruta="/calidad" clave="codigo" etiqueta="Buscar inspecciones" marcador="Código interno, etapa o área" />
          <Vistas
            etiqueta="Vista"
            vistas={VISTAS.map((v) => ({
              clave: v.valor,
              titulo: v.titulo,
              href: conBusqueda(v.valor === 'abiertas' ? '/calidad' : `/calidad?vista=${v.valor}`, busqueda),
              activa: vista === v.valor,
              cuenta: grupos[v.valor].length,
            }))}
          />
        </div>
        <Tarjeta className="overflow-hidden">
          <TablaDeInspecciones
            inspecciones={grupos[vista]}
            vacio={
              busqueda
                ? { titulo: 'Ninguna con esa búsqueda', descripcion: 'Prueba con otro código interno, etapa o área, o en otra vista.' }
                : vista === 'abiertas'
                ? {
                    titulo: 'No hay observaciones abiertas',
                    descripcion: inspecciona
                      ? 'Lo no conforme que registres aparece aquí hasta que lo levantes.'
                      : 'Cuando Calidad observe algo, aparece aquí hasta que se levante.',
                  }
                : vista === 'anuladas'
                  ? { titulo: 'No hay inspecciones anuladas', descripcion: 'Una inspección mal registrada se anula desde su ficha, con su motivo.' }
                  : {
                      titulo: 'Todavía no hay inspecciones',
                      descripcion: inspecciona ? 'Toca «Registrar inspección» al revisar una etapa.' : 'Calidad todavía no registró ninguna.',
                    }
            }
          />
        </Tarjeta>
        {alTope && <Tope />}
      </>
    )
  }

  // El área: lo que Calidad le observó, y lo que ya quedó.
  const porCorregir = inspecciones.filter((i) => i.estado === 'OBSERVADA')
  const resto = inspecciones.filter((i) => i.estado !== 'OBSERVADA')
  return (
    <>
      <EncabezadoPagina
        titulo="Observaciones de calidad"
        descripcion={
          porCorregir.length > 0
            ? `${porCorregir.length} ${porCorregir.length === 1 ? 'observación espera' : 'observaciones esperan'} que tu área la corrija.`
            : 'Lo que Calidad revisó en el trabajo de tu área.'
        }
        ayuda="Cuando Calidad marca no conforme una etapa de tu área, te llega a la campana y aparece aquí. Corrígelo y márcalo corregido con una nota o una foto: Calidad lo revisa y lo levanta. No detiene la etapa siguiente."
        migas={[{ titulo: 'Calidad' }]}
      />
      <div className="space-y-5">
        <Tarjeta className="overflow-hidden">
          <TarjetaCabecera titulo="Por corregir" />
          <TablaDeInspecciones
            inspecciones={porCorregir}
            vacio={{ titulo: 'Nada por corregir', descripcion: 'Cuando Calidad observe algo de tu área, aparece aquí y en la campana.' }}
          />
        </Tarjeta>
        {resto.length > 0 && (
          <Tarjeta className="overflow-hidden">
            <TarjetaCabecera titulo="Lo demás" ayuda="Lo que espera la revisión de Calidad y lo que ya quedó." />
            <TablaDeInspecciones inspecciones={resto} vacio={{ titulo: 'Nada más', descripcion: '' }} />
          </Tarjeta>
        )}
      </div>
      {alTope && <Tope />}
    </>
  )
}

/** La dirección de la vista con la búsqueda puesta: cambiar de vista no la borra. */
function conBusqueda(ruta: string, busqueda: string) {
  if (!busqueda) return ruta
  return `${ruta}${ruta.includes('?') ? '&' : '?'}codigo=${encodeURIComponent(busqueda)}`
}

function Tope() {
  return (
    <p className="mt-3 text-xs text-texto-suave">
      Van las abiertas (hasta {MAXIMO_ABIERTAS}) y las {MAXIMO_INSPECCIONES} cerradas más recientes: para una más vieja, búscala por su código.
    </p>
  )
}

function TablaDeInspecciones({ inspecciones, vacio }: { inspecciones: InspeccionCalidad[]; vacio: { titulo: string; descripcion: string } }) {
  return (
    <Tabla>
      <TablaCabecera>
        <tr>
          <TH>Código y etapa</TH>
          <TH className="hidden md:table-cell">Área</TH>
          <TH className="hidden sm:table-cell">Revisada</TH>
          <TH className="hidden sm:table-cell">Cómo va</TH>
        </tr>
      </TablaCabecera>
      <tbody>
        {inspecciones.length === 0 ? (
          <SinDatos titulo={vacio.titulo} descripcion={vacio.descripcion} />
        ) : (
          inspecciones.map((i) => <FilaInspeccion key={i.id} inspeccion={i} />)
        )}
      </tbody>
    </Tabla>
  )
}

function FilaInspeccion({ inspeccion: i }: { inspeccion: InspeccionCalidad }) {
  return (
    <TR data-inspeccion-calidad={i.id} data-estado={i.estado}>
      <TD className="align-top">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {/* En el teléfono, un blanco de 44 px de alto: el código es el camino a la ficha. */}
          <Link href={`/calidad/${i.id}`} className="tabular inline-flex min-h-11 items-center font-semibold text-acento hover:underline sm:min-h-0">
            {i.codigo_interno}
          </Link>
          <span className="text-sm text-texto">{i.etapa ?? 'Sin etapa'}</span>
        </div>
        {i.observacion && <p className="mt-1 line-clamp-2 max-w-xl text-sm text-texto-suave">{i.observacion}</p>}
        {i.fotos > 0 && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs text-texto-suave">
            <Camera aria-hidden className="size-3.5" />
            {i.fotos} {i.fotos === 1 ? 'foto' : 'fotos'}
          </p>
        )}
        {/* En el teléfono, lo demás va aquí: la tabla no se desliza de costado. */}
        <div className="mt-1 space-y-1 sm:hidden">
          <p className="text-xs text-texto-suave">
            {i.area} · revisada {fechaHora(i.creado_en)}
          </p>
          <Situacion inspeccion={i} />
        </div>
      </TD>
      <TD className="hidden align-top md:table-cell">
        <p className="text-sm text-texto">{i.area}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <p className="tabular text-xs whitespace-nowrap text-texto">{fechaHora(i.creado_en)}</p>
        <p className="mt-0.5 text-xs text-texto-suave md:hidden">{i.area}</p>
      </TD>
      <TD className="hidden align-top sm:table-cell">
        <Situacion inspeccion={i} />
      </TD>
    </TR>
  )
}

/** En quién está la inspección y desde cuándo. */
function Situacion({ inspeccion: i }: { inspeccion: InspeccionCalidad }) {
  const estado = ESTADO_INSPECCION[i.estado]
  const espera = diasAbierta(i.dias_abierta)
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {estado ? <Insignia tono={estado.tono}>{estado.etiqueta}</Insignia> : i.estado}
      {espera && <span className="text-xs text-texto-suave">desde {espera}</span>}
    </div>
  )
}
