"""
Holt die Sprachmodelle für den KI-Chat (GGUF-Format für llama.cpp) und legt sie mit
festem Namen ab. Läuft auf GitHub Actions; die App lädt sie später von dort.

  python llm_models.py out

Qwen3 (Alibaba, Apache-2.0): spricht gut Deutsch, klein genug für normale Computer.
"""
import hashlib, json, os, shutil, sys
from huggingface_hub import list_repo_files, hf_hub_download

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)

# id: (Kandidaten [Repo, ...], bevorzugte Quantisierungen, denkt das Modell standardmäßig?)
MODELS = {
    'qwen3-1.7b': (['unsloth/Qwen3-1.7B-GGUF', 'Qwen/Qwen3-1.7B-GGUF'], ['Q4_K_M', 'Q5_K_M', 'Q8_0'], True),
    'qwen3-4b': (['Qwen/Qwen3-4B-Instruct-2507-GGUF', 'unsloth/Qwen3-4B-Instruct-2507-GGUF', 'Qwen/Qwen3-4B-GGUF', 'unsloth/Qwen3-4B-GGUF'], ['Q4_K_M', 'Q5_K_M', 'Q8_0'], None),
}

for mid, (repos, quants, think) in MODELS.items():
    done = False
    for repo in repos:
        try:
            files = [f for f in list_repo_files(repo) if f.endswith('.gguf')]
        except Exception as e:
            print(f'{repo}: nicht verfügbar ({e.__class__.__name__})')
            continue
        print(f'{repo}: {files}')
        for q in quants:
            hit = [f for f in files if q.lower() in f.lower() and 'mmproj' not in f.lower()]
            if not hit:
                continue
            f = sorted(hit, key=len)[0]
            p = hf_hub_download(repo, f)
            dst = os.path.join(OUT, f'slimsort-llm-{mid}.gguf')
            shutil.copyfile(p, dst)
            is_think = think if think is not None else ('2507' not in repo)
            size = os.path.getsize(dst)
            sha = hashlib.sha256()
            with open(dst, 'rb') as fh:
                for chunk in iter(lambda: fh.read(1 << 24), b''):
                    sha.update(chunk)
            # GitHub erlaubt höchstens 2 GB je Datei → in Stücke teilen, die App setzt sie zusammen
            parts = [os.path.basename(dst)]
            PART = 1900 * 1000 * 1000
            if size > PART:
                parts = []
                with open(dst, 'rb') as fh:
                    n = 0
                    while True:
                        b = fh.read(PART)
                        if not b:
                            break
                        pn = f'{os.path.basename(dst)}.part{n}'
                        open(os.path.join(OUT, pn), 'wb').write(b)
                        parts.append(pn)
                        n += 1
                os.remove(dst)
            json.dump({'id': mid, 'repo': repo, 'file': f, 'quant': q, 'think': is_think, 'license': 'Apache-2.0',
                       'size': size, 'sha256': sha.hexdigest(), 'parts': parts},
                      open(os.path.join(OUT, f'slimsort-llm-{mid}.json'), 'w'))
            print(f'==> {mid}: {repo}/{f} ({size / 1e9:.2f} GB, denkt: {is_think}, Teile: {len(parts)})')
            done = True
            break
        if done:
            break
    assert done, f'kein Modell für {mid}'
