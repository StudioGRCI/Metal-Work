import { EsqueletoTarjetas } from '@/components/ui/esqueleto'

export default function Cargando() {
  // La bandeja apila las tarjetas a lo ancho, nunca en dos columnas: con
  // `lg:grid-cols-2` el esqueleto prometía otra cosa y la pantalla saltaba al
  // llegar los datos.
  return <EsqueletoTarjetas cantidad={4} columnas="grid-cols-1" lineas={2} />
}
