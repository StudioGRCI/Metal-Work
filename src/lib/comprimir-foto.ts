/**
 * Achicar una foto en el teléfono antes de subirla.
 *
 * La cámara de un teléfono saca fotos de 3 a 12 MB; en el taller la señal es
 * floja y el plan de datos es del supervisor. Para ver cómo va un trabajo basta
 * con 1600 px del lado más largo en JPEG al 80 %, que pesa unos cientos de KB.
 * Solo corre en el navegador: dibuja la foto en un lienzo y la vuelve a guardar.
 */
export async function comprimirFoto(original: File, { ladoMaximo = 1600, calidad = 0.8 } = {}): Promise<File> {
  const imagen = await decodificar(original)
  try {
    const escala = Math.min(1, ladoMaximo / Math.max(imagen.ancho, imagen.alto))
    const ancho = Math.max(1, Math.round(imagen.ancho * escala))
    const alto = Math.max(1, Math.round(imagen.alto * escala))

    // Una JPEG que ya es chica y no hay que achicar se sube tal cual: volver a
    // comprimirla solo la empeora.
    if (escala === 1 && original.type === 'image/jpeg' && original.size <= 600 * 1024) return original

    const lienzo = document.createElement('canvas')
    lienzo.width = ancho
    lienzo.height = alto
    const contexto = lienzo.getContext('2d')
    if (!contexto) throw new Error('Sin lienzo')
    contexto.drawImage(imagen.fuente, 0, 0, ancho, alto)

    const blob = await new Promise<Blob | null>((listo) => lienzo.toBlob(listo, 'image/jpeg', calidad))
    if (!blob) throw new Error('Sin imagen')
    const nombre = `${original.name.replace(/\.[^.]+$/, '') || 'foto'}.jpg`
    return new File([blob], nombre, { type: 'image/jpeg', lastModified: Date.now() })
  } finally {
    imagen.liberar()
  }
}

type Decodificada = { fuente: CanvasImageSource; ancho: number; alto: number; liberar: () => void }

/**
 * `createImageBitmap` respeta la orientación que la cámara anota en la foto;
 * si el navegador no sabe abrir el formato con él (HEIC en algunos), se prueba
 * con una imagen común, que en el iPhone sí lo abre.
 */
async function decodificar(archivo: File): Promise<Decodificada> {
  try {
    const mapa = await createImageBitmap(archivo, { imageOrientation: 'from-image' })
    return { fuente: mapa, ancho: mapa.width, alto: mapa.height, liberar: () => mapa.close() }
  } catch {
    const url = URL.createObjectURL(archivo)
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = url
      await img.decode()
      return { fuente: img, ancho: img.naturalWidth, alto: img.naturalHeight, liberar: () => URL.revokeObjectURL(url) }
    } catch (e) {
      URL.revokeObjectURL(url)
      throw e
    }
  }
}
