#!/usr/bin/env python3
"""Comprueba que toda clave i18n usada en el front existe en ES y EN, y que
los dos ficheros tienen exactamente las mismas claves."""
import json, re, sys, pathlib

RAIZ = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
WEB = RAIZ / 'apps/web/src'

def aplanar(d, prefijo=''):
    claves = set()
    for k, v in d.items():
        ruta = f'{prefijo}{k}'
        if isinstance(v, dict):
            claves |= aplanar(v, ruta + '.')
        else:
            claves.add(ruta)
    return claves

es = json.load(open(WEB / 'locales/es.json'))
en = json.load(open(WEB / 'locales/en.json'))
claves_es, claves_en = aplanar(es), aplanar(en)

# i18next resuelve `clave` y también `clave_one` / `clave_other` para plurales.
def existe(clave, claves):
    return clave in claves or (f'{clave}_one' in claves and f'{clave}_other' in claves)

# t('a.b'), t("a.b"), t(`a.b`) y la forma del listado TOP_NAV: key: 'nav.x'
patron_t = re.compile(r"""\bt\(\s*['"`]([A-Za-z0-9_.]+)['"`]""")
patron_key = re.compile(r"""\bkey:\s*['"]([A-Za-z0-9_]+\.[A-Za-z0-9_.]+)['"]""")

usadas = {}
for fichero in sorted(WEB.rglob('*.ts*')):
    texto = fichero.read_text(encoding='utf-8')
    for m in list(patron_t.finditer(texto)) + list(patron_key.finditer(texto)):
        usadas.setdefault(m.group(1), set()).add(
            f'{fichero.relative_to(RAIZ)}:{texto[:m.start()].count(chr(10)) + 1}'
        )

faltan_es = {k: v for k, v in usadas.items() if not existe(k, claves_es)}
faltan_en = {k: v for k, v in usadas.items() if not existe(k, claves_en)}
solo_es = sorted(claves_es - claves_en)
solo_en = sorted(claves_en - claves_es)

print(f'Claves usadas en el front:  {len(usadas)}')
print(f'Claves en es.json:          {len(claves_es)}')
print(f'Claves en en.json:          {len(claves_en)}')
print()

fallo = False
for titulo, faltantes in (('USADAS Y AUSENTES EN ES', faltan_es), ('USADAS Y AUSENTES EN EN', faltan_en)):
    if faltantes:
        fallo = True
        print(f'FALLO - {titulo} ({len(faltantes)}):')
        for k in sorted(faltantes):
            print(f'  {k}  <- {", ".join(sorted(faltantes[k]))}')
    else:
        print(f'OK - {titulo}: ninguna')

if solo_es or solo_en:
    fallo = True
    print(f'FALLO - PARIDAD ES/EN rota: {len(solo_es)} sólo en ES, {len(solo_en)} sólo en EN')
    for k in solo_es:
        print(f'  sólo ES: {k}')
    for k in solo_en:
        print(f'  sólo EN: {k}')
else:
    print('OK - PARIDAD ES/EN: exacta')

print()
print('RESULTADO:', 'FALLO' if fallo else 'TODO CORRECTO')
sys.exit(1 if fallo else 0)
