#!/usr/bin/env python3
"""Trae a Cervantes de Registro Producción 3.0 lo que se terminó de probar en la tablet de GP2.

[Elías, 08/10/2026] «que funcione y envíe los datos como los envía en Reg Prod 3; para en el futuro hacer cambios en GP2 y,
cuando están terminados, decirle a la IA "implementá lo nuevo de GP2 a Reg Prod 3.0 en Cervantes", y que no cometa errores».

Uso (desde la raíz de 3.0):
    python3 tools/traer_de_gp2.py --gp2 <clon de loekemeyer/Gestion-Productiva-2.0> --version 3.1.N

Cómo funciona (y por qué no se equivoca):
  1. La tablet de GP2 es una COPIA de cervantes-gp2/ hecha con tools/copiar_botonera_de_3_0.py de GP2, con 6 diferencias
     conocidas (claves gp2c_, p_app "gp2", COPIA_GP2 en vez de APP_VERSION, sin service worker, «Volver»/«Menú» al menú de
     GP2, auth-guard). Este script DESHACE esas 6 diferencias en operarios_gp2.js, Operarios_GP2.html y test_op_e2e.js.
  2. VUELTA EXACTA: vuelve a aplicar la copia de GP2 (las MISMAS funciones del script de GP2) sobre lo deshecho y exige que dé
     byte por byte lo que hay en GP2. Si alguien tocó en GP2 uno de los 6 puntos de la copia, no lo adivina: se corta y dice cuál.
  3. Si 3.0 cambió desde la copia (la versión de 3.0 de la que salió la copia está en COPIA_GP2), une los dos lados con
     `git merge-file` usando como base esa versión de 3.0 sacada del historial; si chocan en las mismas líneas, se corta.
  4. Si no hay nada nuevo, no escribe nada. Si hay, escribe cervantes-gp2/app.js, index.html, sw.js y tests/cervantes-gp2.cjs
     con la versión nueva (APP_VERSION, SW_VERSION, MI_V, ?v=) y muestra qué cambió.
Con --revisar sólo dice si hay algo nuevo en GP2 (sale 3 si lo hay) y no escribe: se corre ANTES de cambiar cervantes-gp2/ acá
[Elías, 08/10: «antes de hacer un cambio fijate si había cambios en el original de GP2»].
Después: `node tests/cervantes-gp2.cjs`, revisar `git diff`, commitear; y en GP2 volver a copiar
(`python3 tools/copiar_botonera_de_3_0.py --rp3 <este repo> --token <nuevo>`) para que la copia diga la versión nueva.
"""
import argparse
import difflib
import importlib.util
import os
import re
import subprocess
import sys

sys.dont_write_bytecode = True   # al cargar el script del otro repo no deja __pycache__ en ninguno de los dos
import tempfile

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
APP = os.path.join(RAIZ, 'cervantes-gp2', 'app.js')
HTML = os.path.join(RAIZ, 'cervantes-gp2', 'index.html')
SW = os.path.join(RAIZ, 'cervantes-gp2', 'sw.js')
TEST = os.path.join(RAIZ, 'tests', 'cervantes-gp2.cjs')
SW_INI = '/* ============================================================\n   SERVICE WORKER'
INIT = '/* ============================================================\n   INIT'
LLAMADA_SW = '  registrarServiceWorker();\n'
MANIFIESTO = '  <link rel="manifest" href="manifest.json" />\n'


class Falta(Exception):
    pass


def leer(p):
    return open(p, encoding='utf8').read()


def una(src, viejo, nuevo, que):
    n = src.count(viejo)
    if n != 1:
        raise Falta(f'{que}: se esperaba 1 vez y está {n}: {viejo[:100]!r}')
    return src.replace(viejo, nuevo)


def linea_anterior(src, linea, que):
    """La línea (con su salto) que en 3.0 va justo antes de `linea`."""
    i = src.find(linea)
    if i < 0 or src.count(linea) != 1:
        raise Falta(f'{que}: en 3.0 no está una sola vez {linea!r}')
    j = src.rfind('\n', 0, i - 1)
    return src[j + 1:i]


def revertir_js(js, js30):
    m = re.match(r'"use strict";\n\n/\* ⚠ COPIA PARA PROBAR.*?\*/\n', js, re.S)
    if not m:
        raise Falta('operarios_gp2.js: no está la cabecera «⚠ COPIA PARA PROBAR» de la copia')
    js = '"use strict";\n' + js[m.end():]
    mc = re.search(r'const COPIA_GP2 = "gp2-(\d{8}[a-z])/(v[\d.]+)";[^\n]*\n', js)
    if not mc:
        raise Falta('operarios_gp2.js: no está const COPIA_GP2 = "gp2-<token>/<versión>"')
    token, base = mc.group(1), mc.group(2)
    js = js.replace(mc.group(0), f'const APP_VERSION = "{base}";\n')
    js = una(js, 'app_version: COPIA_GP2', 'app_version: APP_VERSION', 'app_version del toque')
    if 'COPIA_GP2' in js:
        raise Falta('operarios_gp2.js: COPIA_GP2 se usa en un lugar nuevo (en 3.0 es APP_VERSION): decidir a mano')
    i, j = js30.find(SW_INI), js30.find(INIT)
    if i < 0 or j < i:
        raise Falta('3.0: no están los bloques SERVICE WORKER / INIT en app.js')
    js = una(js, INIT, js30[i:j] + INIT, 'bloque INIT')
    previa = linea_anterior(js30, LLAMADA_SW, 'llamada al service worker')
    js = una(js, previa, previa + LLAMADA_SW, 'lugar de la llamada al service worker')
    js = js.replace('"gp2c_', '"rp3c_').replace('p_app: "gp2"', 'p_app: "cervantes"')
    js = una(js, 'volver.href = "../../GP2_MODULOS.html"; volver.textContent = "← Volver al menú";',
             'volver.href = "../"; volver.textContent = "← Volver al inicio";', '«Volver» del código de la TV')
    return js, token, base


def revertir_html(html, html30, base):
    m = re.search(r'<meta charset="UTF-8" />\n(<script src="\.\./\.\./auth-guard\.js\?v=[^"]*"></script>)\n', html)
    if not m:
        raise Falta('Operarios_GP2.html: no está el auth-guard después del charset')
    guard = m.group(1)
    html = html.replace(m.group(0), '<meta charset="UTF-8" />\n', 1)
    html = una(html, '<meta name="apple-mobile-web-app-title" content="Operarios GP2" />',
               '<meta name="apple-mobile-web-app-title" content="Registro" />', 'título de la app')
    html = una(html, '<title>Operarios GP2</title>', '<title>Registro Produccion</title>', 'título')
    previa = linea_anterior(html30, MANIFIESTO, 'manifiesto')
    html = una(html, previa, previa + MANIFIESTO, 'lugar del manifiesto')
    mt = re.search(r"var MI_V = '([^']*)';", html)
    if not mt:
        raise Falta('Operarios_GP2.html: MI_V')
    token = mt.group(1)
    html = html.replace(mt.group(0), f"var MI_V = '{base[1:]}';", 1)
    html = una(html, r"html.match(/operarios_gp2\.js\?v=([\w.]+)/)", r"html.match(/app\.js\?v=([\w.]+)/)", 'auto-recarga')
    html = una(html, "var flag = 'gp2_reload_' + m[1];", "var flag = 'rp3c_reload_' + m[1];", 'auto-recarga (flag)')
    html = una(html, '''<button id="btnMenu" title="Salir al menú principal" onclick="location.href='../../GP2_MODULOS.html'">''',
               '''<button id="btnMenu" title="Volver al inicio (elegir planta)" onclick="location.href='../'">''', 'botón Menú')
    html, n = re.subn(r'<script src="operarios_gp2\.js\?v=[^"]*"></script>', f'<script src="app.js?v={base[1:]}"></script>', html)
    if n != 1:
        raise Falta('Operarios_GP2.html: el script operarios_gp2.js del final')
    return html, token, guard


def revertir_test(test, copia, base):
    for viejo, nuevo in reversed(copia.PARES_TEST):
        test = una(test, nuevo, viejo, 'prueba')
    test = test.replace('URL_APP', 'srv.url + "/cervantes-gp2/"').replace('"gp2c_', '"rp3c_')
    return una(test, copia.VERSION_TEST_GP2, f'e1.p.toque.app_version === "{base}"', 'prueba: chequeo de app_version')


def git(*args):
    return subprocess.run(['git', '-C', RAIZ, *args], capture_output=True, text=True, check=True).stdout


def base_de_3_0(ver):
    """El app.js / index.html / prueba de 3.0 en la versión de la que salió la copia (del historial de git)."""
    for sha in git('log', '--format=%H', '--', 'cervantes-gp2/app.js').split():
        try:
            js = git('show', f'{sha}:cervantes-gp2/app.js')
        except subprocess.CalledProcessError:
            continue
        if f'const APP_VERSION = "{ver}";' in js:
            return sha, js, git('show', f'{sha}:cervantes-gp2/index.html'), git('show', f'{sha}:tests/cervantes-gp2.cjs')
    raise Falta(f'no encuentro en el historial de 3.0 la versión {ver} de la que salió la copia')


def unir(actual, base, gp2, que):
    with tempfile.TemporaryDirectory() as d:
        ps = []
        for nombre, txt in (('actual', actual), ('base', base), ('gp2', gp2)):
            p = os.path.join(d, nombre)
            open(p, 'w', encoding='utf8').write(txt)
            ps.append(p)
        r = subprocess.run(['git', 'merge-file', '-p', '-L', '3.0', '-L', 'base', '-L', 'GP2', *ps], capture_output=True, text=True)
        if r.returncode != 0:
            raise Falta(f'{que}: 3.0 y GP2 cambiaron las mismas líneas ({r.returncode} choque(s)); hay que decidir a mano')
        return r.stdout


def mostrar(viejo, nuevo, nombre):
    d = list(difflib.unified_diff(viejo.splitlines(), nuevo.splitlines(), f'3.0/{nombre}', f'nuevo/{nombre}', lineterm='', n=1))
    print(f'  {nombre}: {sum(1 for x in d if x.startswith("+") and not x.startswith("+++"))} líneas nuevas, '
          f'{sum(1 for x in d if x.startswith("-") and not x.startswith("---"))} sacadas')


def cargar_copia(gp2):
    spec = importlib.util.spec_from_file_location('copia_gp2', os.path.join(gp2, 'tools', 'copiar_botonera_de_3_0.py'))
    copia = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(copia)
    return copia


def traer(gp2, avisar=print):
    """Lo de la tablet de GP2 llevado a 3.0, SIN escribir: (js, html, test, base, token). Lanza Falta / copia.Falta si no cierra."""
    copia = cargar_copia(gp2)
    js_gp2 = leer(os.path.join(gp2, 'Produccion', 'RegistroApp', 'operarios_gp2.js'))
    html_gp2 = leer(os.path.join(gp2, 'Produccion', 'RegistroApp', 'Operarios_GP2.html'))
    test_gp2 = leer(os.path.join(gp2, 'tests', 'ui', 'test_op_e2e.js'))
    js30, html30, test30 = leer(APP), leer(HTML), leer(TEST)
    actual = re.search(r'const APP_VERSION = "(v[\d.]+)";', js30).group(1)
    try:
        js, token_js, base = revertir_js(js_gp2, js30)
        html, token_html, guard = revertir_html(html_gp2, html30, base)
        test = revertir_test(test_gp2, copia, base)
        # vuelta exacta: copiar lo deshecho tiene que dar lo que hay en GP2
        for que, ida, gp2txt in (('operarios_gp2.js', copia.copiar_js(js, token_js)[0], js_gp2),
                                 ('Operarios_GP2.html', copia.copiar_html(html, token_html, guard), html_gp2),
                                 ('test_op_e2e.js', copia.copiar_test(test), test_gp2)):
            if ida != gp2txt:
                diff = '\n'.join(list(difflib.unified_diff(gp2txt.splitlines(), ida.splitlines(), 'GP2', 'vuelta', lineterm='', n=0))[:12])
                raise Falta(f'{que}: la vuelta no es exacta (se tocó en GP2 uno de los puntos de la copia):\n{diff}')
        # si 3.0 cambió desde la copia, se unen los dos lados
        if base != actual:
            sha, bjs, bhtml, btest = base_de_3_0(base)
            avisar(f'3.0 cambió desde la copia ({base} -> {actual}): uno con la base {sha[:7]}.')
            js, html, test = unir(js30, bjs, js, 'app.js'), unir(html30, bhtml, html, 'index.html'), unir(test30, btest, test, 'prueba')
    except copia.Falta as e:
        raise Falta(str(e))
    return js, html, test, base, token_html


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--gp2', required=True, help='clon de loekemeyer/Gestion-Productiva-2.0')
    ap.add_argument('--version', help='versión nueva de cervantes-gp2, serie 3.1.N (sin la v); no hace falta con --revisar')
    ap.add_argument('--revisar', action='store_true', help='sólo dice si en GP2 hay algo nuevo; no escribe nada')
    a = ap.parse_args()
    js30, html30, test30, sw30 = leer(APP), leer(HTML), leer(TEST), leer(SW)
    actual = re.search(r'const APP_VERSION = "(v[\d.]+)";', js30).group(1)
    if not a.revisar:
        if not a.version or not re.fullmatch(r'3\.1\.\d+', a.version):
            sys.exit('Falta --version de la serie 3.1.N (ej. 3.1.8), o --revisar para sólo mirar.')
        if [int(x) for x in a.version.split('.')] <= [int(x) for x in actual[1:].split('.')]:
            sys.exit(f'La versión nueva ({a.version}) tiene que ser mayor que la de 3.0 ({actual}).')
    try:
        js, html, test, base, token_html = traer(a.gp2)
    except Falta as e:
        sys.exit('NO SE TRAJO NADA — ' + str(e))
    if (js, html, test) == (js30, html30, test30):
        print(f'No hay nada nuevo en GP2: la tablet es igual a Cervantes {actual}. No se escribió nada.')
        return
    if a.revisar:
        print(f'En GP2 HAY cambios que no están en Cervantes {actual} (copia de {base}, token {token_html}):')
        for nombre, viejo, nuevo in (('app.js', js30, js), ('index.html', html30, html), ('cervantes-gp2.cjs', test30, test)):
            mostrar(viejo, nuevo, nombre)
        print('Para traerlos: --version 3.1.N (sin --revisar). No se escribió nada.')
        sys.exit(3)
    v = 'v' + a.version
    js = una(js, f'const APP_VERSION = "{actual}";', f'const APP_VERSION = "{v}";', 'versión en app.js')
    js = js.replace(f'botonera de GP2 ({actual})', f'botonera de GP2 ({v})', 1)
    html = re.sub(r"var MI_V = '[^']*';", f"var MI_V = '{a.version}';", html, count=1)
    html = re.sub(r'<script src="app\.js\?v=[^"]*"></script>', f'<script src="app.js?v={a.version}"></script>', html, count=1)
    test, n = re.subn(r'e1\.p\.toque\.app_version === "v[\d.]+"', f'e1.p.toque.app_version === "{v}"', test)
    if n != 1:
        sys.exit('NO SE TRAJO NADA — la prueba no tiene el chequeo de app_version (e1.p.toque.app_version === "v…")')
    sw = re.sub(r'const SW_VERSION = "v[^"]*";', f'const SW_VERSION = "{v}";', sw30, count=1)
    print(f'Lo nuevo de GP2 (copia de {base}, token {token_html}) -> Cervantes {v}:')
    for nombre, viejo, nuevo in (('app.js', js30, js), ('index.html', html30, html), ('cervantes-gp2.cjs', test30, test)):
        mostrar(viejo, nuevo, nombre)
    for p, txt in ((APP, js), (HTML, html), (TEST, test), (SW, sw)):
        open(p, 'w', encoding='utf8').write(txt)
    print('Ahora: node tests/cervantes-gp2.cjs · git diff · commit; y en GP2 volver a copiar para que la copia diga ' + v + '.')


if __name__ == '__main__':
    main()
