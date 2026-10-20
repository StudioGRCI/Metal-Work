import { ListaEtapas, resumenEtapas } from '@/components/codigo-interno/etapas'
import { TablaComparada, TablaListaDiseno, TablaLoPedido } from '@/components/codigo-interno/materiales'
import { ListaPlanos } from '@/components/codigo-interno/planos'
import { Tarjeta, TarjetaCabecera, TarjetaCuerpo } from '@/components/ui/tarjeta'
import {
  etapasDeCodigo,
  historialDePlano,
  listaDeMateriales,
  loPedidoDelCodigo,
  materialesComparados,
  planosDeCodigo,
} from '@/lib/datos/diseno-codigos'
import { hoyLima } from '@/lib/format'

/**
 * Lo que Diseño carga por código, a la vista de Gerencia: las etapas con su
 * semáforo, los planos de cada área con quién los recibió, y la lista de
 * materiales contra lo comprado y lo salido. Solo lectura: lo escribe Diseño y
 * lo marca el supervisor del área.
 */

export async function VistaEtapas({ codigo }: { codigo: string }) {
  const [etapas, planos] = await Promise.all([etapasDeCodigo(codigo), planosDeCodigo(codigo)])
  const hoy = hoyLima()
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Etapas de la unidad"
        descripcion={etapas.length > 0 ? `${resumenEtapas(etapas, hoy)}.` : undefined}
        ayuda="Las arma Diseño con su fecha comprometida; el supervisor de cada área marca cuándo empezó y terminó la suya, y el avance sale de su reporte diario."
      />
      <TarjetaCuerpo>
        {etapas.length === 0 ? (
          <p className="text-sm text-texto-suave">Diseño todavía no armó las etapas de este código. Las carga en «Control de etapas».</p>
        ) : (
          <ListaEtapas etapas={etapas} hoy={hoy} conPlanosConPeso={planos.some((p) => !p.anulado_en && (p.peso ?? 0) > 0)} />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

export async function VistaPlanos({ codigo }: { codigo: string }) {
  const planos = await planosDeCodigo(codigo)
  const historial = new Map(await Promise.all(planos.filter((p) => p.revisiones > 1).map(async (p) => [p.id, await historialDePlano(p.id)] as const)))
  return (
    <Tarjeta>
      <TarjetaCabecera
        titulo="Planos"
        ayuda="Los planos que cargó Diseño para cada área de producción, con su revisión vigente y si el área ya la recibió."
      />
      <TarjetaCuerpo>
        {planos.length === 0 ? (
          <p className="text-sm text-texto-suave">Diseño todavía no cargó planos para este código.</p>
        ) : (
          <ListaPlanos planos={planos} historial={historial} />
        )}
      </TarjetaCuerpo>
    </Tarjeta>
  )
}

export async function VistaMateriales({ codigo }: { codigo: string }) {
  const [comparados, lineas, pedido] = await Promise.all([materialesComparados(codigo), listaDeMateriales(codigo), loPedidoDelCodigo(codigo)])
  return (
    <>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera
          titulo="Lo que lleva la unidad contra lo comprado y lo salido"
          ayuda="La lista de Diseño, material por material, frente a las OC con este código (menos las rechazadas) y a lo que salió del almacén para él (menos lo devuelto)."
        />
        <TablaComparada materiales={comparados} />
      </Tarjeta>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lista de materiales de Diseño" ayuda="Línea por línea, con el plano del que sale cada una." />
        <TablaListaDiseno lineas={lineas} />
      </Tarjeta>
      <Tarjeta className="overflow-hidden">
        <TarjetaCabecera titulo="Lo que pidieron las áreas" ayuda="Los requerimientos con este código, menos los anulados." />
        <TablaLoPedido lineas={pedido} />
      </Tarjeta>
    </>
  )
}
