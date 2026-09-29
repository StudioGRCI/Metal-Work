import { redirect } from 'next/navigation'

/** La atención de cada solicitud ahora vive en la pestaña Materiales de su OT. */
export default function PaginaAtencionMateriales() {
  redirect('/ordenes')
}
