/** Los avisos solo navegan a pantallas internas, nunca a una URL externa. */
export function destinoAviso(ruta: string | null, origen: string | null): string | null {
  if (!ruta || !ruta.startsWith('/') || ruta.startsWith('//') || /[\\\u0000-\u0020]/.test(ruta)) return null
  return origen && !ruta.includes('#') ? `${ruta}#${encodeURIComponent(origen)}` : ruta
}
