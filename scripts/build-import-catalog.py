"""Build the offline search catalog from official USDA JSON zip downloads.

Usage: python3 scripts/build-import-catalog.py /path/to/SR.zip /path/to/FNDDS.zip
No network request is made by this script. Sources and licenses: docs/food-import.md.
"""
import hashlib
import json
import sys
import zipfile
from pathlib import Path

rows = []
sources = []
nutrients = [1008, 1003, 1005, 1004, 1079]  # kcal, protein, carbohydrate, fat, fibre
for path in map(Path, sys.argv[1:]):
    with zipfile.ZipFile(path) as archive:
        raw = archive.read(next(n for n in archive.namelist() if n.endswith('.json')))
    foods = next(iter(json.loads(raw).values()))
    sources.append({'file': path.name, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    for f in foods:
        values = {n['nutrient']['id']: n.get('amount') for n in f['foodNutrients']}
        macros = [values.get(n) for n in nutrients]
        if any(v is None or v < 0 or v > (1000 if i == 0 else 100) for i, v in enumerate(macros)):
            continue  # Missing values are not zero.
        portions = []
        for p in f.get('foodPortions', []):
            label = p.get('portionDescription') or f"{p.get('amount', 1):g} {p.get('modifier', '')}"
            grams = p.get('gramWeight')
            if grams and 0 < grams <= 100000 and label.strip() and 'not specified' not in label.lower():
                pair = [label.strip()[:180], grams]
                if pair not in portions:
                    portions.append(pair)
        category = f.get('foodCategory', {}).get('description') or f.get('wweiaFoodCategory', {}).get('wweiaFoodCategoryDescription', '')
        rows.append([f['fdcId'], f['description'][:200], 1 if f['dataType'] == 'Survey (FNDDS)' else 0, category, *macros, portions[:12]])
rows.sort(key=lambda x: x[0])
out = Path(__file__).resolve().parents[1] / 'public' / 'data'
out.mkdir(exist_ok=True)
(out / 'usda-foods.json').write_text(json.dumps(rows, ensure_ascii=False, separators=(',', ':')) + '\n')
(out / 'usda-sources.json').write_text(json.dumps({'sources': sources, 'foods': len(rows), 'license': 'USDA public domain (CC0)'}, indent=2) + '\n')
print(f'{len(rows):,} foods; {(out / "usda-foods.json").stat().st_size:,} bytes')
