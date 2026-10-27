"""
Baut die genaueren Bild-/Text-Modelle für die KI-Stufen "Ausgewogen" und "Maximal"
(läuft auf GitHub Actions, siehe .github/workflows/ki-modell.yml).

  python export_siglip.py google/siglip2-base-patch16-224 siglip2-b16 out
  python export_siglip.py google/siglip2-large-patch16-256 siglip2-l16 out

SigLIP 2 (Google, Apache-2.0) versteht Text in vielen Sprachen direkt. Gewichte als int8
(je Zeile skaliert), Wortliste auf lateinische Schrift gekürzt.

Ergebnis:  slimsort-ki-<id>.safetensors  +  slimsort-ki-<id>-ref.json (Vergleichswerte für Rust)
"""
import json, os, sys
import numpy as np
import torch
from safetensors.numpy import save_file
from transformers import AutoModel, AutoTokenizer, AutoImageProcessor

NAME, ID, OUT = sys.argv[1], sys.argv[2], sys.argv[3] if len(sys.argv) > 3 else 'out'
os.makedirs(OUT, exist_ok=True)
torch.set_grad_enabled(False)

T = {}


def quant(name, w):
    w = w.detach().float().numpy()
    w = w.reshape(w.shape[0], -1)
    s = np.abs(w).max(axis=1) / 127.0
    s[s == 0] = 1e-8
    T[name + '.q'] = np.clip(np.round(w / s[:, None]), -127, 127).astype(np.int8)
    T[name + '.s'] = s.astype(np.float32)


def f32(name, t):
    T[name] = t.detach().float().numpy().astype(np.float32)


def linear(name, lin):
    quant(name, lin.weight)
    if lin.bias is not None:
        f32(name + '.b', lin.bias)


def norm(name, ln):
    f32(name + '.w', ln.weight)
    f32(name + '.b', ln.bias)


def layers(prefix, enc):
    for i, L in enumerate(enc.layers):
        p = f'{prefix}.{i}.'
        norm(p + 'ln1', L.layer_norm1)
        linear(p + 'q', L.self_attn.q_proj)
        linear(p + 'k', L.self_attn.k_proj)
        linear(p + 'v', L.self_attn.v_proj)
        linear(p + 'o', L.self_attn.out_proj)
        norm(p + 'ln2', L.layer_norm2)
        linear(p + 'fc1', L.mlp.fc1)
        linear(p + 'fc2', L.mlp.fc2)
    return len(enc.layers)


model = AutoModel.from_pretrained(NAME, torch_dtype=torch.float32).eval()
tok = AutoTokenizer.from_pretrained(NAME)
try:
    improc = AutoImageProcessor.from_pretrained(NAME, use_fast=False).to_dict()
except Exception as e:
    improc = f'nicht lesbar: {e}'
cfg = model.config
vc, tc = cfg.vision_config, cfg.text_config
print('Typ:', cfg.model_type, '| Bild:', vc.hidden_size, vc.num_hidden_layers, vc.image_size, vc.patch_size, vc.hidden_act, '| Text:', tc.hidden_size, tc.num_hidden_layers, tc.max_position_embeddings, tc.hidden_act)
print('Bildvorbereitung:', improc)
assert vc.hidden_act in ('gelu_pytorch_tanh', 'gelu_new'), vc.hidden_act
assert tc.hidden_act in ('gelu_pytorch_tanh', 'gelu_new'), tc.hidden_act
try:
    from huggingface_hub import ModelCard
    for line in ModelCard.load(NAME).text.splitlines():
        if 'lower' in line.lower():
            print('Modellkarte:', line.strip())
except Exception as e:
    print('Modellkarte nicht lesbar:', e)

# ------------------------------------------------------------------ Bild
V = model.vision_model
quant('v.patch', V.embeddings.patch_embedding.weight)  # [D, 3*p*p]
f32('v.patch.b', V.embeddings.patch_embedding.bias)
f32('v.pos', V.embeddings.position_embedding.weight)
nv = layers('v', V.encoder)
norm('v.post', V.post_layernorm)
H = V.head
f32('v.probe', H.probe.reshape(-1))
D = vc.hidden_size
W, B = H.attention.in_proj_weight, H.attention.in_proj_bias
quant('v.hq', W[:D]); f32('v.hq.b', B[:D])
quant('v.hk', W[D:2 * D]); f32('v.hk.b', B[D:2 * D])
quant('v.hv', W[2 * D:]); f32('v.hv.b', B[2 * D:])
linear('v.ho', H.attention.out_proj)
norm('v.hln', H.layernorm)
linear('v.hfc1', H.mlp.fc1)
linear('v.hfc2', H.mlp.fc2)

# ------------------------------------------------------------------ Text + Wortliste
tj = json.loads(tok.backend_tokenizer.to_str())
m = tj['model']
print('Tokenizer:', m['type'], {k: m.get(k) for k in ('byte_fallback', 'fuse_unk', 'ignore_merges', 'unk_token', 'continuing_subword_prefix', 'end_of_word_suffix')})
print('Normalizer:', json.dumps(tj.get('normalizer'))[:400])
print('Pre-Tokenizer:', json.dumps(tj.get('pre_tokenizer'))[:400])
print('Post-Processor:', json.dumps(tj.get('post_processor'))[:400])
assert m['type'] == 'BPE'

vocab = [None] * len(m['vocab'])
for w, i in m['vocab'].items():
    vocab[i] = w
for t in tj.get('added_tokens', []):
    if t['id'] < len(vocab) and vocab[t['id']] is None:
        vocab[t['id']] = t['content']


def latin(ch):
    o = ord(ch)
    return o < 0x250 or 0x1E00 <= o <= 0x1EFF or 0x2000 <= o <= 0x206F or 0x20A0 <= o <= 0x20CF or ch == '▁'


keep = [i for i, w in enumerate(vocab) if w is not None and ((w.startswith('<') and w.endswith('>')) or all(latin(c) for c in w))]
remap = {old: new for new, old in enumerate(keep)}
kept = set(vocab[i] for i in keep)
merges = []
for mg in m['merges']:
    a, b = mg.split(' ', 1) if isinstance(mg, str) else mg
    if a in kept and b in kept and (a + b) in kept:
        merges.append(a + ' ' + b)
print(f'Wortliste: {len(vocab)} -> {len(keep)}, Verbindungen: {len(m["merges"])} -> {len(merges)}')

TX = model.text_model
quant('t.word', TX.embeddings.token_embedding.weight[keep])
f32('t.pos', TX.embeddings.position_embedding.weight)
nt = layers('t', TX.encoder)
norm('t.post', TX.final_layer_norm)
linear('t.head', TX.head)
T['vocab'] = np.frombuffer('\n'.join(vocab[i] for i in keep).encode('utf-8'), dtype=np.uint8).copy()
T['merges'] = np.frombuffer('\n'.join(merges).encode('utf-8'), dtype=np.uint8).copy()

pad = tok.pad_token_id
meta = {
    'format': 'slimsort-ki-2', 'arch': 'siglip', 'source': NAME,
    'v_layers': str(nv), 'v_heads': str(vc.num_attention_heads), 'v_dim': str(D), 'v_patch': str(vc.patch_size),
    'v_size': str(vc.image_size), 'v_eps': str(vc.layer_norm_eps),
    't_layers': str(nt), 't_heads': str(tc.num_attention_heads), 't_dim': str(tc.hidden_size),
    't_max': str(tc.max_position_embeddings), 't_eps': str(tc.layer_norm_eps),
    'pad': str(remap[pad]), 'unk': str(remap[tok.unk_token_id]) if tok.unk_token_id is not None else '0',
    'bos': str(remap[tok.bos_token_id]) if tok.bos_token_id is not None else '',
    'eos': str(remap[tok.eos_token_id]) if tok.eos_token_id is not None else '',
    'byte_fallback': '1' if m.get('byte_fallback') else '0',
    'normalizer': json.dumps(tj.get('normalizer')), 'post': json.dumps(tj.get('post_processor')),
    'embed_dim': str(D), 'logit_scale': str(float(model.logit_scale.exp())), 'logit_bias': str(float(model.logit_bias)),
    'license': f'{NAME} (Apache-2.0, Google)',
}
fn = os.path.join(OUT, f'slimsort-ki-{ID}.safetensors')
save_file(T, fn, metadata=meta)

# ------------------------------------------------------------------ Vergleichswerte
S = vc.image_size


def pattern(kind):
    y, x = np.mgrid[0:S, 0:S]
    if kind == 'red':
        return np.stack([np.full_like(x, 230), np.full_like(x, 30), np.full_like(x, 30)], -1)
    if kind == 'blue':
        return np.stack([np.full_like(x, 30), np.full_like(x, 60), np.full_like(x, 220)], -1)
    return np.stack([(x * 3 + y * 5) % 256, (x * y) % 256, (x + 2 * y) % 256], -1)


def img_embed(rgb):
    a = (rgb.astype(np.float32) / 255.0 - 0.5) / 0.5
    t = torch.from_numpy(a.transpose(2, 0, 1)[None].copy())
    e = model.get_image_features(pixel_values=t)[0].numpy()
    return (e / np.linalg.norm(e)).tolist()


texts = ['this is a photo of a red picture.', 'ein blaues bild', 'ein baum links, eine wiese und ein berg', 'hund am strand', 'größe, straße! (café) – naïve 2024?', 'a parachute in the sky']
ref = {'images': {k: img_embed(pattern(k)) for k in ['red', 'blue', 'pattern']}, 'texts': {}}
for s in texts:
    ids = tok([s], padding='max_length', max_length=tc.max_position_embeddings, truncation=True)['input_ids'][0]
    e = model.get_text_features(input_ids=torch.tensor([ids]))[0].numpy()
    ref['texts'][s] = {'ids': [remap.get(i, -1) for i in ids], 'embed': (e / np.linalg.norm(e)).tolist()}
    print(repr(s), '->', ids[:16])
json.dump(ref, open(os.path.join(OUT, f'slimsort-ki-{ID}-ref.json'), 'w'))

im = np.array([ref['images'][k] for k in ['red', 'blue']])
for s in texts[:2]:
    c = im @ np.array(ref['texts'][s]['embed'])
    print(s, 'cos', c, 'p', 1 / (1 + np.exp(-(c * float(model.logit_scale.exp()) + float(model.logit_bias)))))
print('Größe:', os.path.getsize(fn) / 1e6, 'MB')
