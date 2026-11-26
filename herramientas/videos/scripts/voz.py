#!/usr/bin/env python3
"""La voz de un video y sus tiempos: del guion a `voz.wav` y `linea.json`.

    python3 scripts/voz.py videos/como-pedir-un-rq [horizontal] [vertical]

Por cada formato:

1. Lee `guion.json` y saca lo que se dice en ese formato (el vertical es más
   corto: cada frase puede traer su texto `vertical`, o quedar fuera con "").
2. Genera la voz de cada escena con Microsoft Edge TTS (es-PE-CamilaNeural,
   velocidad del guion). Una locución por escena: suena de corrido, no a frases
   pegadas. Se guarda por su contenido: si el texto no cambió, no se vuelve a pedir.
3. Pasa Whisper por cada locución y saca el tiempo de cada palabra. Con eso se
   sabe cuándo empieza y termina cada frase: de ahí salen los subtítulos y los
   cortes. Como segunda medida se guardan las marcas de palabra del propio Edge
   TTS y se avisa si las dos se separan más de 0,3 s.
4. Une las locuciones con sus silencios en `generado/<formato>/voz.wav` y
   escribe `generado/<formato>/linea.json`: cada escena, cada frase y cada
   subtítulo con su segundo exacto. La plantilla de Remotion y la revisión
   automática leen ese archivo y nada más.

Necesita: `pip install edge-tts faster-whisper` y `ffmpeg`.
Variables: WHISPER_MODELO (large-v3-turbo), SSL_CERT_FILE (si la red sale por
un proxy con su propio certificado).
"""
from __future__ import annotations

import asyncio
import difflib
import hashlib
import json
import os
import re
import subprocess
import sys
import unicodedata
import wave
from pathlib import Path

import numpy as np

RAIZ = Path(__file__).resolve().parent.parent
FORMATOS = json.loads((RAIZ / 'src' / 'plantilla' / 'formatos.json').read_text())
FRECUENCIA = 48000

# Los silencios de la plantilla, en segundos. Son parte del formato: iguales en
# todos los videos.
RITMO = {
    'horizontal': {'entrada': 0.4, 'entre_escenas': 0.6, 'portada': 2.0, 'cola': 2.2},
    'vertical': {'entrada': 0.3, 'entre_escenas': 0.45, 'portada': 2.0, 'cola': 1.8},
}
# Lo que cabe en un subtítulo: dos renglones con la letra de cada formato.
LARGO_SUBTITULO = {'horizontal': 78, 'vertical': 50}
GANCHO_MAXIMO = 5.0
DESFASE_MAXIMO = 0.3


def normalizar(texto: str) -> str:
    sin = unicodedata.normalize('NFD', texto.lower())
    sin = ''.join(c for c in sin if unicodedata.category(c) != 'Mn')
    return re.sub(r'[^a-z0-9ñ ]+', ' ', sin).strip()


def palabras_de(texto: str) -> list[str]:
    return [p for p in texto.split() if normalizar(p)]


def texto_del_formato(frase, formato: str) -> str:
    """El texto de una frase en un formato; "" si ese formato no la dice."""
    if isinstance(frase, str):
        return frase
    if formato == 'vertical' and 'vertical' in frase:
        return frase['vertical']
    return frase['texto']


def para_decir(texto: str, pronunciacion: dict[str, str]) -> str:
    """Lo que se le manda a la voz: las comillas fuera y las siglas como se dicen."""
    dicho = texto.replace('«', '').replace('»', '')
    for escrito, hablado in pronunciacion.items():
        dicho = re.sub(rf'\b{re.escape(escrito)}\b', hablado, dicho)
    return dicho


# ------------------------------------------------------------------ Edge TTS


async def _edge(texto: str, voz: str, velocidad: str, salida: Path) -> list[dict]:
    import certifi

    if os.environ.get('SSL_CERT_FILE'):
        # edge-tts confía solo en la lista de certifi; detrás de un proxy con
        # certificado propio hay que darle la de la máquina.
        certifi.where = lambda: os.environ['SSL_CERT_FILE']
    import edge_tts

    marcas: list[dict] = []
    locucion = edge_tts.Communicate(texto, voz, rate=velocidad, boundary='WordBoundary')
    with salida.open('wb') as f:
        async for parte in locucion.stream():
            if parte['type'] == 'audio':
                f.write(parte['data'])
            elif parte['type'] == 'WordBoundary':
                marcas.append({'t': parte['text'], 'i': parte['offset'] / 1e7, 'f': (parte['offset'] + parte['duration']) / 1e7})
    return marcas


def locutar(texto: str, voz: dict, cache: Path) -> tuple[Path, list[dict]]:
    sello = hashlib.sha256(f"{voz['nombre']}|{voz['velocidad']}|{texto}".encode()).hexdigest()[:16]
    mp3 = cache / f'{sello}.mp3'
    marcas = cache / f'{sello}.edge.json'
    if not (mp3.exists() and mp3.stat().st_size > 0 and marcas.exists()):
        for intento in range(4):
            try:
                m = asyncio.run(_edge(texto, voz['nombre'], voz['velocidad'], mp3))
                marcas.write_text(json.dumps(m, ensure_ascii=False))
                break
            except Exception as e:  # la red: se reintenta con calma
                if intento == 3:
                    raise
                print(f'    Edge TTS falló ({e.__class__.__name__}); reintento…')
                asyncio.run(asyncio.sleep(2 * (intento + 1)))
    return mp3, json.loads(marcas.read_text())


def leer_audio(ruta: Path, frecuencia: int) -> np.ndarray:
    crudo = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(ruta), '-f', 'f32le', '-ac', '1', '-ar', str(frecuencia), '-'],
        check=True,
        capture_output=True,
    ).stdout
    return np.frombuffer(crudo, dtype=np.float32)


# ------------------------------------------------------------------- Whisper

_modelo = None


def whisper():
    global _modelo
    if _modelo is None:
        from faster_whisper import WhisperModel

        _modelo = WhisperModel(os.environ.get('WHISPER_MODELO', 'large-v3-turbo'), device='cpu', compute_type='int8', cpu_threads=os.cpu_count() or 4)
    return _modelo


def oir(audio16k: np.ndarray, pista: str = '') -> list[dict]:
    """Las palabras que Whisper oye, con su inicio y su fin en segundos."""
    segmentos, _ = whisper().transcribe(
        audio16k, language='es', word_timestamps=True, initial_prompt=pista or None, condition_on_previous_text=False, vad_filter=False
    )
    return [{'t': p.word.strip(), 'i': float(p.start), 'f': float(p.end)} for s in segmentos for p in (s.words or [])]


def alinear(escritas: list[str], oidas: list[dict], duracion: float) -> list[dict]:
    """A cada palabra del guion, el tiempo de la que Whisper oyó en su lugar.

    Whisper no siempre escribe igual que el guion («erre cu» por «RQ», un número
    en cifras): las que coinciden anclan y las de en medio se reparten el hueco
    en proporción a su largo.
    """
    if not oidas:
        raise SystemExit('Whisper no oyó nada en una locución: revisar el audio.')
    a = [normalizar(p) for p in escritas]
    b = [normalizar(p['t']) for p in oidas]
    tiempos: list[tuple[float, float]] = [(0.0, 0.0)] * len(a)

    def repartir(i1: int, i2: int, desde: float, hasta: float):
        largos = [max(1, len(x)) for x in a[i1:i2]]
        t = desde
        for k, largo in enumerate(largos):
            paso = (hasta - desde) * largo / sum(largos)
            tiempos[i1 + k] = (t, t + paso)
            t += paso

    for orden, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if orden == 'equal':
            for k in range(i2 - i1):
                tiempos[i1 + k] = (oidas[j1 + k]['i'], oidas[j1 + k]['f'])
        elif orden == 'replace':
            # Whisper oyó otra cosa en ese tramo («3» por «Tres»): es ese mismo tramo.
            repartir(i1, i2, oidas[j1]['i'], oidas[j2 - 1]['f'])
        elif orden == 'delete':
            # Whisper no oyó nada ahí: el hueco entre sus vecinas.
            desde = oidas[j1 - 1]['f'] if j1 > 0 else 0.0
            hasta = oidas[j1]['i'] if j1 < len(oidas) else duracion
            repartir(i1, i2, desde, hasta)
    return [{'t': p, 'i': round(t[0], 3), 'f': round(t[1], 3)} for p, t in zip(escritas, tiempos)]


def _suena(audio: np.ndarray) -> np.ndarray:
    """Por cada 10 ms, si hay voz. La música de fondo no cuenta como voz."""
    paso = FRECUENCIA // 100
    n = len(audio) // paso
    volumen = np.sqrt(np.mean(audio[: n * paso].reshape(n, paso) ** 2, axis=1)) if n else np.zeros(0)
    return volumen > max(0.012, float(volumen.max()) * 0.06) if n else volumen > 1


def arranque(inicio: float, fin: float, suena: np.ndarray) -> float:
    """Dónde empieza de verdad a sonar una palabra.

    Whisper pega cada palabra al final de la anterior, con la pausa de en medio
    adentro: después de una coma, «y» puede figurar 0,4 s antes de oírse. Si
    entre el inicio y el fin de la palabra hay un silencio de 150 ms o más, la
    palabra empieza donde ese silencio termina.
    """
    n = len(suena)
    if n == 0:
        return inicio
    i = min(n - 1, max(0, int(inicio * 100)))
    hallado = None
    callado = 0
    for k in range(i, min(n - 1, int(fin * 100)) + 1):
        if suena[k]:
            if callado >= 15:
                hallado = k
            callado = 0
        else:
            callado += 1
    return inicio if hallado is None else hallado / 100


def ajustar_al_sonido(inicio: float, fin: float, audio: np.ndarray, fin_primera: float | None = None) -> tuple[float, float]:
    """Lleva el inicio y el fin de una frase a donde de verdad suena.

    Whisper suele adelantar la primera palabra y alargar la última. Con el fin
    de la primera palabra (`fin_primera`) se salta la pausa que Whisper le haya
    dejado adentro (`arranque`); si el inicio cae en silencio se corre hasta
    donde arranca la voz, y el fin, hasta donde se apaga.
    """
    suena = _suena(audio)
    n = len(suena)
    if n == 0:
        return inicio, fin
    if fin_primera is not None:
        inicio = arranque(inicio, fin_primera, suena)
    i = min(n - 1, max(0, int(inicio * 100)))
    f = min(n - 1, max(0, int(fin * 100)))
    tope = min(n - 1, i + 120)
    while i < tope and not suena[i : i + 3].all():
        i += 1
    piso = max(i, f - 120)
    while f > piso and not suena[max(0, f - 3) : f].all():
        f -= 1
    return i / 100, max(f / 100, i / 100 + 0.05)


# --------------------------------------------------------------- subtítulos


def partir_subtitulos(palabras: list[dict], maximo: int) -> list[dict]:
    """Parte una frase en subtítulos que caben en pantalla.

    Los trozos salen parejos —nunca una palabra suelta al final— y, si se
    puede, el corte cae donde la frase respira (una coma, dos puntos).
    """
    largo = lambda a, b: len(' '.join(x['t'] for x in palabras[a:b]))  # noqa: E731
    n = len(palabras)
    trozos = max(1, -(-largo(0, n) // maximo))
    while True:
        ideal = largo(0, n) / trozos
        # mejor[k][i]: el menor costo de repartir las primeras i palabras en k trozos.
        mejor = [[(float('inf'), 0)] * (n + 1) for _ in range(trozos + 1)]
        mejor[0][0] = (0.0, 0)
        for k in range(1, trozos + 1):
            for i in range(k, n + 1):
                for j in range(k - 1, i):
                    tramo = largo(j, i)
                    if tramo > maximo or mejor[k - 1][j][0] == float('inf'):
                        continue
                    costo = (tramo - ideal) ** 2
                    if i < n and palabras[i - 1]['t'][-1] in ',;:.?!':
                        costo -= (ideal * 0.45) ** 2
                    if i - j == 1 and trozos > 1:
                        costo += ideal**2
                    if mejor[k - 1][j][0] + costo < mejor[k][i][0]:
                        mejor[k][i] = (mejor[k - 1][j][0] + costo, j)
        if mejor[trozos][n][0] < float('inf'):
            break
        trozos += 1
    cortes = [n]
    for k in range(trozos, 0, -1):
        cortes.append(mejor[k][cortes[-1]][1])
    cortes.reverse()
    # Cada trozo se queda en pantalla hasta que entra el siguiente: en la pausa de una coma no se queda la pantalla sin subtítulo.
    return [
        {'texto': ' '.join(x['t'] for x in palabras[a:b]), 'inicio': palabras[a]['i'], 'fin': palabras[b]['i'] if b < n else palabras[b - 1]['f']}
        for a, b in zip(cortes, cortes[1:])
    ]


# ------------------------------------------------------------------ el video


def hacer(carpeta: Path, formato: str) -> bool:
    guion = json.loads((carpeta / 'guion.json').read_text())
    ritmo = RITMO[formato]
    salida = carpeta / 'generado' / formato
    cache = carpeta / 'generado' / 'voz'
    salida.mkdir(parents=True, exist_ok=True)
    cache.mkdir(parents=True, exist_ok=True)
    pronunciacion = guion.get('pronunciacion', {})
    pista = guion.get('pista_whisper', '')
    bien = True

    pista_voz: list[np.ndarray] = []
    reloj = 0.0

    def silencio(segundos: float):
        nonlocal reloj
        pista_voz.append(np.zeros(int(round(segundos * FRECUENCIA)), dtype=np.float32))
        reloj += segundos

    escenas = []
    subtitulos = []
    desfases = []
    silencio(ritmo['entrada'])
    print(f'{formato}:')
    for n, escena in enumerate(guion['escenas']):
        con_indice = [(i, t) for i, t in ((i, texto_del_formato(f, formato)) for i, f in enumerate(escena.get('frases', []))) if t]
        frases = [t for _, t in con_indice]
        inicio_escena = reloj if n else 0.0
        registro = {'indice': n, 'tipo': escena['tipo'], 'frases': []}
        if not frases:
            # Sin voz: la portada dura lo que manda la plantilla.
            silencio(escena.get('duracion', ritmo['portada']))
        else:
            dicho = ' '.join(para_decir(f, pronunciacion) for f in frases)
            mp3, marcas_edge = locutar(dicho, guion['voz'], cache)
            audio = leer_audio(mp3, FRECUENCIA)
            # Edge deja silencio al principio y al final: se recorta para que
            # los silencios entre escenas sean los de la plantilla.
            fuerte = np.flatnonzero(np.abs(audio) > 0.004)
            a, b = max(0, fuerte[0] - int(0.05 * FRECUENCIA)), min(len(audio), fuerte[-1] + int(0.12 * FRECUENCIA))
            recorte = a / FRECUENCIA
            audio = audio[a:b]
            duracion = len(audio) / FRECUENCIA
            oidas = oir(leer_audio(mp3, 16000)[int(recorte * 16000) :], pista)
            escritas = [p for f in frases for p in palabras_de(f)]
            tiempos = alinear(escritas, oidas, duracion)
            suena = _suena(audio)
            # La segunda medida: las marcas de Edge, palabra por palabra dicha.
            dichas = [p for f in frases for p in palabras_de(para_decir(f, pronunciacion))]
            edge = alinear(dichas, [{'t': m['t'], 'i': m['i'] - recorte, 'f': m['f'] - recorte} for m in marcas_edge], duracion)
            k = 0
            kd = 0
            for indice, texto in con_indice:
                cuantas = len(palabras_de(texto))
                cuantas_dichas = len(palabras_de(para_decir(texto, pronunciacion)))
                tramo = [dict(p) for p in tiempos[k : k + cuantas]]
                tramo[0]['i'], tramo[-1]['f'] = ajustar_al_sonido(tramo[0]['i'], tramo[-1]['f'], audio, tramo[0]['f'])
                tramo[0]['f'] = max(tramo[0]['f'], tramo[0]['i'] + 0.05)
                # Dentro de la frase también: tras una coma, la palabra empieza cuando suena.
                for p in tramo[1:]:
                    p['i'] = min(arranque(p['i'], p['f'], suena), p['f'] - 0.03)
                tramo[-1]['i'] = min(tramo[-1]['i'], tramo[-1]['f'] - 0.05)
                pal = [{'t': p['t'], 'i': round(reloj + max(0.0, p['i']), 3), 'f': round(reloj + min(duracion, p['f']), 3)} for p in tramo]
                segun_edge = reloj + max(0.0, edge[kd]['i'])
                desfases.append((abs(pal[0]['i'] - segun_edge), texto))
                registro['frases'].append({'indice': indice, 'texto': texto, 'inicio': pal[0]['i'], 'fin': pal[-1]['f'], 'inicio_edge': round(segun_edge, 3), 'palabras': pal})
                subtitulos.extend(partir_subtitulos(pal, LARGO_SUBTITULO[formato]))
                k += cuantas
                kd += cuantas_dichas
            pista_voz.append(audio)
            reloj += duracion
            print(f"  escena {n + 1} ({escena['tipo']}): {duracion:5.2f} s · {len(frases)} frase(s) · Whisper oyó «{' '.join(o['t'] for o in oidas)}»")
        ultima = n == len(guion['escenas']) - 1
        if ultima:
            silencio(ritmo['cola'])
            fin_escena = reloj
        else:
            silencio(ritmo['entre_escenas'])
            fin_escena = reloj - ritmo['entre_escenas'] / 2
        registro['inicio'] = round(inicio_escena if n == 0 else escenas[-1]['fin'], 3)
        registro['fin'] = round(fin_escena, 3)
        escenas.append(registro)

    # Un subtítulo se queda hasta que entra el siguiente si el hueco es corto:
    # así no parpadea entre frase y frase.
    for s, siguiente in zip(subtitulos, subtitulos[1:]):
        if 0 < siguiente['inicio'] - s['fin'] < 0.35:
            s['fin'] = siguiente['inicio']
    for s in subtitulos:
        s['inicio'], s['fin'] = round(s['inicio'], 3), round(s['fin'], 3)

    voz = np.concatenate(pista_voz)
    pico = float(np.max(np.abs(voz))) or 1.0
    voz = voz / pico * 0.89  # −1 dB de pico
    with wave.open(str(salida / 'voz.wav'), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(FRECUENCIA)
        w.writeframes((voz * 32767).astype('<i2').tobytes())

    duracion_total = round(len(voz) / FRECUENCIA, 3)
    linea = {
        'video': guion['id'],
        'formato': formato,
        'duracion': duracion_total,
        'escenas': escenas,
        'subtitulos': subtitulos,
    }
    (salida / 'linea.json').write_text(json.dumps(linea, ensure_ascii=False, indent=1) + '\n')

    limites = FORMATOS[formato]['duracion']
    print(f"  duración {duracion_total:.1f} s (el formato pide de {limites['minimo']} a {limites['maximo']} s)")
    if not limites['minimo'] <= duracion_total <= limites['maximo']:
        print('  FALLA: la duración se sale del formato: alargar o recortar el guion.')
        bien = False
    gancho = escenas[0]
    if gancho['tipo'] != 'gancho' or gancho['frases'][-1]['fin'] > GANCHO_MAXIMO:
        print(f"  FALLA: el gancho termina en {gancho['frases'][-1]['fin']:.1f} s; tiene que caber en los primeros {GANCHO_MAXIMO:.0f} s.")
        bien = False
    peor = max(desfases)
    print(f'  Whisper contra las marcas de Edge TTS: desfase máximo {peor[0]:.2f} s («{peor[1][:40]}…»)')
    if peor[0] > DESFASE_MAXIMO:
        print(f'  FALLA: una frase empieza a más de {DESFASE_MAXIMO} s de donde la marca la voz.')
        bien = False
    return bien


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    carpeta = Path(sys.argv[1]).resolve()
    formatos = sys.argv[2:] or list(FORMATOS)
    bien = True
    for formato in formatos:
        bien = hacer(carpeta, formato) and bien
    return 0 if bien else 1


if __name__ == '__main__':
    sys.exit(main())
