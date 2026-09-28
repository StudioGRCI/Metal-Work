import { redirect } from 'next/navigation'

/** Los enlaces antiguos conservan una salida hacia la lista de órdenes. */
export default function PaginaAvance() {
  redirect('/ordenes')
}
