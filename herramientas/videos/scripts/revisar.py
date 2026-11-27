#!/usr/bin/env python3
"""La revisión automática de un video terminado, antes de entregarlo.

    python3 scripts/revisar.py videos/como-pedir-un-rq [horizontal] [vertical]

Mira el MP4 final (`salida/<video>-<formato>.mp4`), no los intermedios, y
comprueba cuatro cosas:

1. EL FORMATO. Tamaño, 30 cuadros por segundo, H.264 + AAC y la duración que
   pide cada formato; el gancho, dentro de los primeros 5 s.
2. LA VOZ CONTRA EL GUION. Whisper transcribe el audio del video final y se
   compara palabra por palabra con el guion: nada cortado ni cambiado.
3. DATOS REALES. Se comparan todos los cuadros del video y se lee con OCR cada
   cuadro que cambia (y cada captura original, a su tamaño completo): no puede
   aparecer un RUC, un DNI, un monto, un correo, un teléfono ni una clave.
   Además las capturas tienen que venir del banco local con una cuenta de prueba.
4. LOS SUBTÍTULOS. Cada subtítulo se busca en pantalla con OCR en el cuadro en
   que debe entrar, y su entrada se compara con el momento en que Whisper oye
   su primera palabra en el video final: el desfase no pasa de 0,3 s.

Escribe `salida/revision-<formato>.md` y termina con código distinto de cero si
algo falla. Lo que marca como dato real puede ser un error de lectura del OCR:
guarda el cuadro en `generado/<formato>/revision/` para mirarlo; no se da por
bueno sin mirarlo.

Necesita: `faster-whisper`, `pillow`, `ffmpeg` y `tesseract` con el idioma `spa`.
"""
from __future__ import annotations

import difflib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image, ImageOps

sys.path.insert(0, str(Path(__file__).resolve().parent))
from voz import FRECUENCIA, GANCHO_MAXIMO, ajustar_al_sonido, alinear, normalizar, oir, palabras_de, texto_del_formato, validar_guion  # noqa: E402

RAIZ = Path(__file__).resolve().parent.parent
FORMATOS = json.loads((RAIZ / 'src' / 'plantilla' / 'formatos.json').read_text())
DESFASE_MAXIMO = 0.3
CUADROS_OCR_POR_SEGUNDO = 6

# Lo que no puede salir en un video. Ante la duda, se marca: una serie de 8 u
# 11 cifras es un DNI o un RUC tenga la puntuación que tenga al lado, y toda
# cifra con dos decimales es un monto aunque el OCR se haya comido la moneda.
MONEDA = r'(?:(?<![A-Za-z])S\s?/\.?|(?<![\d/])5\s?/\.?(?!\s*\d{1,2}\s*/)|US\s?\$|\$|\b(?:USD|PEN))'
DATOS = [
    ('RUC', re.compile(r'(?<!\d)\d{11}(?!\d)|(?<![\d-])[12]\d \d{3} \d{3} \d{3}(?![\d-])')),
    ('DNI', re.compile(r'(?<!\d)\d{8}(?!\d)|(?<![\d/.,:-])\d{4} \d{4}(?![\d/.,:-])')),
    ('teléfono', re.compile(r'(?<!\d)(?:\d{7}|\d{9}|\d{10})(?!\d)|(?<![\d-])9\d{2}[ -]\d{3}[ -]\d{3}(?![\d-])|\(0?\d{1,2}\)\s?\d{3}[ -]?\d{4}(?!\d)')),
    ('monto', re.compile(MONEDA + r'\s*\d[\d.,]*|(?<![\d.,])\d[\d,]*\.\d{2}(?![\d])(?!\s?%)|\d[\d.,]*\s?(?:soles|d[oó]lares)\b', re.I)),
    ('correo', re.compile(r'[\w.+-]+@[\w-]+\.[\w.-]+')),
    ('clave', re.compile(r'contrase[ñn]a|password|\bclave\b|\btoken\b|api[ _-]?key', re.I)),
]
MONTOS_INVENTADOS_MAXIMO = 4
CORREO_DE_PRUEBA = re.compile(r'@metalwork\.test$', re.I)
NUMEROS = {'uno': '1', 'dos': '2', 'tres': '3', 'cuatro': '4', 'cinco': '5', 'seis': '6', 'siete': '7', 'ocho': '8', 'nueve': '9', 'diez': '10'}


def correr(*args: str, binario: bool = False):
    r = subprocess.run(args, capture_output=True, text=not binario)
    if r.returncode != 0:
        raise SystemExit(f"Falló {' '.join(args[:3])}…: {r.stderr if not binario else r.stderr.decode(errors='replace')}")
    return r.stdout


def leer_texto(imagen: Path | Image.Image, modo: str = '11') -> str:
    """El texto de una imagen, con tesseract. `11` = texto suelto (una pantalla); `6` = un bloque (un subtítulo)."""
    # Un hilo por lectura: se leen varias a la vez, y tesseract con sus propios
    # hilos encima se estorba solo (ocho capturas tardaban más de diez minutos).
    entorno = {**os.environ, 'OMP_THREAD_LIMIT': '1'}
    if isinstance(imagen, Image.Image):
        r = subprocess.run(['tesseract', 'stdin', 'stdout', '-l', 'spa', '--psm', modo], input=_png(imagen), capture_output=True, env=entorno)
    else:
        r = subprocess.run(['tesseract', str(imagen), 'stdout', '-l', 'spa', '--psm', modo], capture_output=True, env=entorno)
    return r.stdout.decode(errors='replace')


def leer_pantalla(imagen: Path | Image.Image) -> str:
    """Una pantalla leída de las dos maneras, una tras otra.

    Como texto suelto (`11`) tesseract entiende mejor una pantalla con
    columnas, pero se salta renglones que son solo cifras; como un solo bloque
    (`6`) mezcla las columnas y no se salta ninguno. Para buscar datos se
    quieren los dos: lo probó un DNI pintado en la cabecera, que como texto
    suelto no se leía a ningún tamaño.
    """
    return leer_texto(imagen, '11') + '\n' + leer_texto(imagen, '6')


def _png(imagen: Image.Image) -> bytes:
    import io

    b = io.BytesIO()
    imagen.save(b, 'PNG')
    return b.getvalue()


def valor_del_monto(escrito: str) -> float | None:
    """«US$ 135,000.00» → 135000.0. Lo que no se entiende como número no vale nada: no se perdona."""
    m = re.search(r'\d[\d.,]*', re.sub(r'^\s*5\s?/', '', escrito))
    if not m:
        return None
    numero = m.group(0).rstrip('.,').replace(',', '')
    try:
        return float(numero)
    except ValueError:
        return None


def moneda_del_monto(escrito: str) -> str | None:
    """La moneda con que está escrito, o None si el número va solo (el campo de un formulario)."""
    e = escrito.upper().replace(' ', '')
    if e.startswith(('US$', 'USD', '$')) or 'DOLARES' in e or 'DÓLARES' in e:
        return 'USD'
    if e.startswith(('S/', '5/', 'PEN')) or 'SOLES' in e:
        return 'PEN'
    return None


def cifras(escrito: str) -> str:
    return re.sub(r'\D', '', re.sub(r'^\s*5\s?/', '', escrito))


def datos_en(texto: str, inventados: tuple[tuple[str, float], ...] = (), vistos: set | None = None) -> list[tuple[str, str]]:
    """Lo que parece un dato real en un texto.

    `inventados` son los montos, con su moneda, que el `capturar.mjs` del video
    declaró haber inventado él mismo en el banco local: esos, y solo esos, se
    dejan pasar (y se anotan en `vistos`). Con la moneda escrita tiene que ser
    la declarada; el número solo —el campo de un formulario— pasa por su
    valor. Un RUC, un DNI, un teléfono, un correo o una clave no se pueden
    declarar.
    """
    hallados = []
    for nombre, patron in DATOS:
        for m in patron.finditer(texto):
            if nombre == 'correo' and CORREO_DE_PRUEBA.search(m.group(0)):
                continue
            if nombre == 'monto':
                valor, moneda = valor_del_monto(m.group(0)), moneda_del_monto(m.group(0))
                suyo = next((d for d in inventados if d[1] == valor and moneda in (None, d[0])), None)
                if suyo:
                    if vistos is not None:
                        vistos.add(suyo)
                    continue
            hallados.append((nombre, m.group(0)))
    return hallados


def es_resto_de_inventado(escrito: str, inventados: tuple[tuple[str, float], ...]) -> bool:
    """Un monto inventado leído a medias: el OCR parte «135,000.00» en «135,» y «000.00», o un fundido tapa el final.

    Se compara con el monto como se escribe («135,000.00»). Con la moneda al
    lado tiene que ser la declarada y el comienzo del monto («US$ 13»); sin
    moneda, un comienzo o un final cortado justo en una coma o en el punto
    («135», «000.00»). Un monto entero distinto («US$ 5,000.00», «S/ 45.00»)
    no es un trozo: es otro monto.
    """
    moneda = moneda_del_monto(escrito)
    leido = re.sub(r'[^\d.,]', '', re.sub(r'^\s*5\s?/', '', escrito)).strip('.,')
    if not leido:
        return False
    for suya, valor in inventados:
        entero = f'{valor:,.2f}'
        if moneda:
            if moneda == suya and entero.startswith(leido) and leido != entero:
                return True
            continue
        if entero.startswith(leido) and entero[len(leido) : len(leido) + 1] in (',', '.'):
            return True
        if entero.endswith(leido) and entero[: len(entero) - len(leido)][-1:] in (',', '.'):
            return True
    return False


def mismo_dato(hallado: tuple[str, str]) -> tuple[str, object]:
    """Con qué se compara un dato entre dos lecturas del mismo cuadro: su clase y su valor, sin adornos."""
    clase, escrito = hallado
    if clase == 'monto':
        return clase, valor_del_monto(escrito)
    if clase in ('RUC', 'DNI', 'teléfono'):
        return clase, re.sub(r'\D', '', escrito)
    return clase, escrito.lower() if clase == 'correo' else None


def comparable(palabra: str) -> str:
    n = normalizar(palabra)
    return NUMEROS.get(n, n)


class Informe:
    def __init__(self, titulo: str):
        self.lineas = [f'# {titulo}', '']
        self.fallas: list[str] = []

    def seccion(self, titulo: str):
        self.lineas += ['', f'## {titulo}', '']

    def paso(self, bien: bool, texto: str):
        self.lineas.append(f"- {'✅' if bien else '❌'} {texto}")
        print(f"  {'ok   ' if bien else 'FALLA'} · {texto}")
        if not bien:
            self.fallas.append(texto)

    def nota(self, texto: str):
        self.lineas.append(f'  - {texto}')


def revisar(carpeta: Path, formato: str) -> bool:
    guion = json.loads((carpeta / 'guion.json').read_text())
    f = FORMATOS[formato]
    fps = f['fps']
    video = carpeta / 'salida' / f"{guion['id']}-{formato}.mp4"
    generado = carpeta / 'generado' / formato
    trabajo = generado / 'revision'
    trabajo.mkdir(parents=True, exist_ok=True)
    for viejo in trabajo.glob('*.png'):
        viejo.unlink()
    linea = json.loads((generado / 'linea.json').read_text())
    inf = Informe(f"Revisión automática · {guion['tarea']} · {f['nombre'].lower()}")
    inf.lineas += [f'Video: `salida/{video.name}`', '']
    print(f'{formato}:')

    # ------------------------------------------------------------ 1. formato
    inf.seccion('1. Formato')
    faltas = validar_guion(guion)
    inf.paso(not faltas, 'el guion trae las seis partes en su orden (gancho, portada, antes y después, pasos, por qué importa y cierre de 3 puntos) y la voz del formato' if not faltas else f"el guion no sigue el formato: {'; '.join(faltas)}")
    sonda = json.loads(correr('ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(video)))
    v = next(s for s in sonda['streams'] if s['codec_type'] == 'video')
    a = next((s for s in sonda['streams'] if s['codec_type'] == 'audio'), None)
    duracion = float(sonda['format']['duration'])
    inf.paso(v['width'] == f['ancho'] and v['height'] == f['alto'], f"{v['width']}×{v['height']} (se pide {f['ancho']}×{f['alto']})")
    inf.paso(v['r_frame_rate'] == f'{fps}/1', f"{v['r_frame_rate'].split('/')[0]} cuadros por segundo")
    inf.paso(v['codec_name'] == 'h264' and a is not None and a['codec_name'] == 'aac', f"video {v['codec_name']} y audio {a['codec_name'] if a else 'ninguno'} (se pide H.264 + AAC)")
    # Una pista que arranca tarde corre la voz contra la imagen en cualquier reproductor.
    arranques = {s['codec_type']: float(s.get('start_time') or 0) for s in sonda['streams']}
    inf.paso(all(abs(t) <= 0.05 for t in arranques.values()), 'el video y el audio arrancan juntos, en cero' if all(abs(t) <= 0.05 for t in arranques.values()) else f"las pistas no arrancan juntas: {', '.join(f'{c} en {t:.2f} s' for c, t in arranques.items())}")
    inf.paso(f['duracion']['minimo'] <= duracion <= f['duracion']['maximo'], f"dura {duracion:.1f} s (el formato pide de {f['duracion']['minimo']} a {f['duracion']['maximo']} s)")

    # ---------------------------------------------------- 2. voz contra guion
    inf.seccion('2. La voz del video final contra el guion (Whisper)')
    # El audio se mide donde lo pone el reproductor: si la pista arranca tarde, ese silencio cuenta.
    crudo = correr('ffmpeg', '-v', 'error', '-i', str(video), '-af', 'aresample=async=1:first_pts=0', '-f', 'f32le', '-ac', '1', '-ar', '16000', '-', binario=True)
    audio16 = np.frombuffer(crudo, dtype=np.float32)
    crudo = correr('ffmpeg', '-v', 'error', '-i', str(video), '-af', 'aresample=async=1:first_pts=0', '-f', 'f32le', '-ac', '1', '-ar', str(FRECUENCIA), '-', binario=True)
    audio = np.frombuffer(crudo, dtype=np.float32)
    oidas = oir(audio16, guion.get('pista_whisper', ''))
    frases = [t for e in guion['escenas'] for t in (texto_del_formato(x, formato) for x in e.get('frases', [])) if t]
    escritas = [p for t in frases for p in palabras_de(t)]
    g = [comparable(p) for p in escritas]
    o = [comparable(p['t']) for p in oidas]
    cruce = difflib.SequenceMatcher(None, g, o, autojunk=False)
    iguales = sum(b.size for b in cruce.get_matching_blocks())
    parecido = iguales / max(1, len(g))
    acertadas = [False] * len(g)
    for b in cruce.get_matching_blocks():
        for k in range(b.size):
            acertadas[b.a + k] = True
    inf.paso(parecido >= 0.93, f'Whisper oye {iguales} de las {len(g)} palabras del guion ({parecido:.0%}; se pide 93 % o más)')
    for orden, i1, i2, j1, j2 in cruce.get_opcodes():
        if orden != 'equal':
            inf.nota(f"guion «{' '.join(escritas[i1:i2]) or '—'}» · se oye «{' '.join(p['t'] for p in oidas[j1:j2]) or '—'}»")
    # «Nada cortado»: dos palabras seguidas del guion que no se oyen son un corte, esté donde esté.
    seguidas = [' '.join(escritas[i : i + 2]) for i in range(len(g) - 1) if not acertadas[i] and not acertadas[i + 1]]
    inf.paso(not seguidas, 'no faltan dos palabras seguidas del guion en ninguna parte' if not seguidas else f"faltan palabras seguidas del guion: {' | '.join(seguidas[:6])}")
    k = 0
    flojas = []
    for t in frases:
        n = len(palabras_de(t))
        perdidas = n - sum(acertadas[k : k + n])
        # Una palabra mal oída se tolera (Whisper oye «revise» por «revisa»); más de eso, no.
        if perdidas >= 2 and (n - perdidas) / n < 0.85:
            flojas.append(t)
        k += n
    inf.paso(not flojas, 'ninguna frase cortada ni cambiada' if not flojas else f"frases que no se oyen como en el guion: {' | '.join(flojas)}")
    inf.paso(acertadas[0] and acertadas[-1], 'se oyen la primera y la última palabra del guion: no está cortado al principio ni al final')
    tiempos = alinear(escritas, oidas, duracion)
    n_gancho = len(palabras_de(frases[0]))
    fin_gancho = tiempos[n_gancho - 1]['f']
    inf.paso(fin_gancho <= GANCHO_MAXIMO, f'el gancho termina de oírse en {fin_gancho:.1f} s (tiene los primeros {GANCHO_MAXIMO:.0f} s)')

    # ------------------------------------------------------- 3. datos reales
    inf.seccion('3. Datos reales, RUC/DNI, claves y montos')
    origen_archivo = carpeta / 'capturas' / formato / 'origen.json'
    origen = json.loads(origen_archivo.read_text()) if origen_archivo.exists() else {}
    local = bool(re.match(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$', origen.get('base', '')))
    inf.paso(local and origen.get('cuenta', '').endswith('.local@metalwork.test'), f"las capturas salieron del banco local ({origen.get('base', 'sin origen')}) con la cuenta de prueba {origen.get('cuenta', '—')}")

    # Los montos que el video inventó y declaró: una cotización de prueba no se entiende sin su total.
    declarados = origen.get('montosInventados', [])
    inventados = tuple((str(d['moneda']), float(d['valor'])) for d in declarados if isinstance(d, dict) and d.get('moneda') in ('USD', 'PEN'))
    inf.paso(
        len(inventados) == len(declarados) and len(inventados) <= MONTOS_INVENTADOS_MAXIMO,
        f'la captura declara {len(inventados)} monto(s) inventado(s), cada uno con su moneda (se admiten hasta {MONTOS_INVENTADOS_MAXIMO})',
    )
    vistos: set[tuple[str, float]] = set()
    sin_datos = 'sin RUC, DNI, teléfonos, correos ni claves' + (', y sin más montos que los inventados que declaró la captura' if inventados else ' ni montos')

    texto_guion = json.dumps(guion, ensure_ascii=False)
    en_guion = [h for h in datos_en(texto_guion) if h[0] != 'clave']
    inf.paso(not en_guion, 'el guion, los rótulos y los subtítulos no nombran ningún dato real' if not en_guion else f'el guion trae {en_guion}')

    # Las capturas son las que tomó `capturar.mjs`: su huella quedó anotada al tomarlas.
    anotadas = json.loads((carpeta / 'capturas' / formato / 'capturas.json').read_text())
    cambiadas = [c['archivo'] for c in anotadas.values() if hashlib.sha256((carpeta / 'capturas' / formato / c['archivo']).read_bytes()).hexdigest() != c.get('sha256')]
    inf.paso(not cambiadas, f'las {len(anotadas)} capturas son las que tomó la captura (huella sha256)' if not cambiadas else f"capturas sin huella o cambiadas después de tomarlas: {', '.join(cambiadas)}")
    # Y el video se armó con esas: Remotion lee la copia que `hacer.mjs` deja en generado/publico
    # justo antes de armar la imagen. Si se tomaron capturas nuevas y no se rehízo la imagen, lo
    # que se lee abajo sin perdonar nada no es lo que el video muestra.
    usadas = carpeta / 'generado' / 'publico' / 'capturas' / formato
    no_son = [c['archivo'] for c in anotadas.values() if not (usadas / c['archivo']).exists() or hashlib.sha256((usadas / c['archivo']).read_bytes()).hexdigest() != c.get('sha256')]
    inf.paso(
        not no_son,
        'el video se armó con esas mismas capturas (la copia que usó Remotion tiene la misma huella)'
        if not no_son
        else f"el video no se armó con estas capturas, o falta la copia que usó Remotion (generado/publico): {', '.join(no_son)}. Rehacer desde la imagen: node scripts/hacer.mjs <video> --desde=imagen",
    )

    capturas = sorted((carpeta / 'capturas' / formato).glob('*.png'))
    with ThreadPoolExecutor(4) as grupo:
        textos = list(grupo.map(leer_pantalla, capturas))
    en_capturas = [(c.name, h) for c, t in zip(capturas, textos) for h in datos_en(t, inventados)]
    # Lo que las capturas dicen, pegado. En un cuadro chico el OCR se come el guion de «9001-2026»
    # o el espacio de «1. 10 KG» y quedan ocho cifras seguidas o un «1.10», que parecen un DNI o un
    # monto y no lo son: las capturas, leídas enteras, no los traen. Para el DNI solo se pegan
    # guiones y barras (un número de documento, una fecha): ocho cifras partidas por un espacio en
    # la captura sí pueden ser un DNI, y arriba ya se marcan.
    sin_guiones = [re.sub(r'[/-]+', '', t) for t in textos]
    sin_espacios = [re.sub(r'\s+', '', t) for t in textos]

    def es_texto_pegado(hallado) -> bool:
        clase, valor = hallado
        if clase == 'DNI':
            return bool(re.fullmatch(r'\d{8}', valor)) and any(re.search(rf'(?<!\d){valor}(?!\d)', pegado) for pegado in sin_guiones)
        if clase == 'monto' and not moneda_del_monto(valor):
            return any(re.sub(r'\s+', '', valor) in pegado for pegado in sin_espacios)
        return False

    inf.paso(not en_capturas, f'las {len(capturas)} capturas, leídas a su tamaño completo: {sin_datos}' if not en_capturas else f'en las capturas: {en_capturas}')

    # Todos los cuadros, en chico, para saber cuáles cambian; esos se leen.
    ancho_chico, alto_chico = 96, round(96 * f['alto'] / f['ancho'] / 2) * 2
    crudo = correr('ffmpeg', '-v', 'error', '-i', str(video), '-vf', f'scale={ancho_chico}:{alto_chico},format=gray', '-f', 'rawvideo', '-', binario=True)
    chicos = np.frombuffer(crudo, dtype=np.uint8).reshape(-1, alto_chico, ancho_chico).astype(np.int16)
    total = len(chicos)
    elegidos = [0]
    for i in range(1, total):
        distinto = float(np.mean(np.abs(chicos[i] - chicos[elegidos[-1]])))
        quieto = float(np.mean(np.abs(chicos[i] - chicos[i - 1]))) < 0.05
        # Se lee lo que cambió: enseguida si la imagen ya se detuvo, y si sigue en movimiento, como mucho unas veces por segundo.
        # Y uno por segundo aunque nada parezca cambiar: una letra chica que aparece sobre una imagen quieta casi no mueve la medida.
        if (distinto > 0.25 and quieto and i - elegidos[-1] >= 2) or (distinto > 1.0 and i - elegidos[-1] >= fps // CUADROS_OCR_POR_SEGUNDO) or i - elegidos[-1] >= fps:
            elegidos.append(i)
    seleccion = '+'.join(f'eq(n\\,{i})' for i in elegidos)
    # La selección se pasa por archivo: con cientos de cuadros no cabe en la línea de órdenes.
    filtro = trabajo / 'cuadros.txt'
    filtro.write_text(f"select='{seleccion}'")
    correr('ffmpeg', '-y', '-v', 'error', '-i', str(video), '-filter_script:v', str(filtro), '-vsync', '0', str(trabajo / 'c-%05d.png'))
    cuadros = sorted(trabajo.glob('c-*.png'))
    with ThreadPoolExecutor(4) as grupo:
        textos = list(grupo.map(leer_pantalla, cuadros))
    en_cuadros = []
    dudosos = []

    for archivo, numero, t in zip(cuadros, elegidos, textos):
        hallados = datos_en(t, inventados, vistos)
        if not hallados:
            archivo.unlink()
            continue
        # En un cuadro de video la letra es chica y a medio fundido hay dos
        # pantallas encimadas: el OCR lee «90012026» donde dice «9001-2026», o
        # «135,900.00» donde dice «135,000.00». El cuadro se lee dos veces más,
        # al doble y al triple de tamaño: lo que está de verdad en pantalla sale
        # igual en otra lectura; el ruido, no. Esto vale porque todo lo que el
        # video muestra del sistema sale de las capturas, y esas se leyeron
        # arriba a su tamaño completo y sin perdonar nada.
        gris = Image.open(archivo).convert('L')
        otras = []
        for veces in (2, 3):
            grande = gris.resize((gris.width * veces, gris.height * veces), Image.LANCZOS)
            otras.append({mismo_dato(h) for h in datos_en(leer_pantalla(grande), inventados)})
        confirmados = [
            h
            for h in hallados
            if not (h[0] == 'monto' and es_resto_de_inventado(h[1], inventados))
            and not es_texto_pegado(h)
            and any(mismo_dato(h) in lectura for lectura in otras)
        ]
        if confirmados:
            en_cuadros.append((numero, confirmados))
            archivo.rename(trabajo / f'DATO-{numero / fps:07.2f}s.png')
        else:
            dudosos.append((numero, hallados))
            archivo.rename(trabajo / f'dudoso-{numero / fps:07.2f}s.png')
    filtro.unlink()
    inf.paso(
        not en_cuadros,
        f'los {total} cuadros del video comparados uno por uno; leídos con OCR los {len(elegidos)} en que la imagen cambia: {sin_datos}'
        if not en_cuadros
        else f'{len(en_cuadros)} cuadro(s) con algo que parece un dato real; mirarlos en generado/{formato}/revision/',
    )
    for numero, hallados in en_cuadros[:20]:
        inf.nota(f"{numero / fps:.2f} s: {', '.join(f'{n} «{v}»' for n, v in hallados)}")
    for numero, hallados in dudosos[:20]:
        inf.nota(f"lectura dudosa en {numero / fps:.2f} s ({', '.join(f'{n} «{v}»' for n, v in hallados)}): trozo de un monto inventado, texto de las capturas leído sin su guion o su espacio, o lectura que no se repite al leer el cuadro otra vez al doble y al triple de tamaño; queda en generado/{formato}/revision/ para mirarlo")

    if inventados:
        dicho = lambda d: f'{d[0]} {d[1]:,.2f}'  # noqa: E731
        sin_ver = [d for d in inventados if d not in vistos]
        inf.paso(
            not sin_ver,
            f"los montos inventados que declaró la captura ({', '.join(dicho(d) for d in inventados)}) se leen en los cuadros del video: no hay ninguno declarado de más. Los escribió el propio video en el banco local; no salen de ninguna cotización real"
            if not sin_ver
            else f"la captura declara montos que no salen en el video: {', '.join(dicho(d) for d in sin_ver)}; se quitan de `montosInventados`",
        )

    # ---------------------------------------------------------- 4. subtítulos
    inf.seccion('4. Subtítulos')
    franja = f['subtitulos']
    caja = (0, franja['y'] - 6, f['ancho'], franja['y'] + franja['alto'] + 6)

    def cuadro(numero: int) -> Image.Image:
        numero = max(0, min(total - 1, numero))
        png = correr('ffmpeg', '-v', 'error', '-ss', f'{numero / fps:.4f}', '-i', str(video), '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-', binario=True)
        return Image.open(io.BytesIO(png)).convert('L').crop(caja)

    def se_lee(numero: int, texto: str) -> float:
        # Letra blanca sobre fondo oscuro: invertida, tesseract la lee mejor.
        imagen = ImageOps.autocontrast(ImageOps.invert(cuadro(numero)).point(lambda p: 255 if p > 110 else 0))
        leido = normalizar(leer_texto(imagen, '6'))
        return difflib.SequenceMatcher(None, normalizar(texto), leido).ratio()

    def medir(sub):
        entra = round(sub['inicio'] * fps)
        sale = round(sub['fin'] * fps)
        return se_lee(entra + 3, sub['texto']), se_lee(entra - 2, sub['texto']), se_lee((entra + sale) // 2, sub['texto'])

    subtitulos = linea['subtitulos']
    with ThreadPoolExecutor(4) as grupo:
        lecturas = list(grupo.map(medir, subtitulos))
    no_estan = [s['texto'] for s, (ya, antes, medio) in zip(subtitulos, lecturas) if max(ya, medio) < 0.75]
    adelantados = [s['texto'] for i, (s, (ya, antes, medio)) in enumerate(zip(subtitulos, lecturas)) if antes >= 0.75 and not (i > 0 and normalizar(subtitulos[i - 1]['texto']) == normalizar(s['texto']))]
    inf.paso(not no_estan, f'los {len(subtitulos)} subtítulos se leen en pantalla en su momento (OCR sobre el video final)' if not no_estan else f"subtítulos que no se leen en pantalla: {' | '.join(no_estan)}")
    inf.paso(not adelantados, 'ninguno está en pantalla antes de su cuadro de entrada' if not adelantados else f"en pantalla antes de tiempo: {' | '.join(adelantados)}")

    # Sin huecos: mientras se habla hay un subtítulo en pantalla.
    hablado = sum(fr['fin'] - fr['inicio'] for e in linea['escenas'] for fr in e['frases'])
    cubierto = sum(s['fin'] - s['inicio'] for s in subtitulos)
    inf.paso(cubierto >= hablado * 0.97, f'hay subtítulo en pantalla todo el tiempo que se habla ({cubierto:.1f} s de {hablado:.1f} s de voz)')

    # El desfase: cuándo entra cada subtítulo contra cuándo se oye su primera palabra en el video final.
    k = 0
    desfases = []
    for s in subtitulos:
        n = len(palabras_de(s['texto']))
        # Whisper pega la primera palabra al final de la anterior: se lleva a donde de verdad arranca la voz,
        # con la misma regla con que se armó la línea de tiempo pero medida otra vez, sobre el sonido del MP4 final.
        oye, _ = ajustar_al_sonido(tiempos[k]['i'], tiempos[k + n - 1]['f'], audio, tiempos[k]['f'])
        en_pantalla = round(s['inicio'] * fps) / fps
        desfases.append((abs(en_pantalla - oye), en_pantalla - oye, s['texto']))
        k += n
    peor = max(desfases)
    medio = sum(d[0] for d in desfases) / len(desfases)
    inf.paso(peor[0] <= DESFASE_MAXIMO, f'desfase máximo entre el subtítulo y la voz: {peor[0]:.2f} s («{peor[2][:50]}»); promedio {medio:.2f} s (el tope es {DESFASE_MAXIMO} s)')
    for d in sorted(desfases, reverse=True)[:3]:
        inf.nota(f"{d[1]:+.2f} s · «{d[2]}»")

    # --------------------------------------------------------------- veredicto
    inf.seccion('Veredicto')
    if inf.fallas:
        inf.lineas.append(f'**NO se entrega así: {len(inf.fallas)} comprobación(es) fallan.**')
    else:
        por_mirar = f' Hay {len(dudosos)} lectura(s) dudosa(s) anotada(s) arriba: se miran esos cuadros.' if dudosos else ''
        inf.lineas.append(f'**Pasa la revisión automática.**{por_mirar} Falta verlo completo, de principio a fin, antes de entregarlo.')
    (carpeta / 'salida' / f'revision-{formato}.md').write_text('\n'.join(inf.lineas) + '\n')
    print(f"  → salida/revision-{formato}.md · {'PASA' if not inf.fallas else 'NO PASA'}")
    return not inf.fallas


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    carpeta = Path(sys.argv[1]).resolve()
    formatos = sys.argv[2:] or list(FORMATOS)
    bien = True
    for formato in formatos:
        bien = revisar(carpeta, formato) and bien
    return 0 if bien else 1


if __name__ == '__main__':
    sys.exit(main())
