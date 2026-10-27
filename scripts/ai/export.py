"""
Baut das KI-Modell für SlimSort (läuft auf GitHub Actions, siehe .github/workflows/ki-modell.yml).

- Bild-Teil:  openai/clip-vit-base-patch32 (Lizenz MIT)
- Text-Teil:  sentence-transformers/clip-ViT-B-32-multilingual-v1 (Apache-2.0) – versteht
              Deutsch, Englisch, Französisch, Spanisch, Italienisch … im selben "Raum" wie die Bilder.

Ergebnis (in out/):
  slimsort-ki-1.safetensors  Gewichte als int8 (je Zeile skaliert) + Wortliste
  slimsort-ki-1-ref.json     Vergleichswerte für den Rust-Test

Die Wortliste wird auf Wörter mit lateinischer Schrift gekürzt (spart rund ein Drittel der Größe).
"""
import json, os, sys, unicodedata
import numpy as np
import torch
from safetensors.numpy import save_file
from transformers import CLIPVisionModelWithProjection
from sentence_transformers import SentenceTransformer

OUT = sys.argv[1] if len(sys.argv) > 1 else 'out'
os.makedirs(OUT, exist_ok=True)
torch.set_grad_enabled(False)

T = {}  # name -> numpy array


def quant(name, w):
    """Gewicht [out, in] als int8 mit einem Faktor je Zeile speichern."""
    w = w.detach().float().numpy()
    w = w.reshape(w.shape[0], -1)
    s = np.abs(w).max(axis=1) / 127.0
    s[s == 0] = 1e-8
    q = np.clip(np.round(w / s[:, None]), -127, 127).astype(np.int8)
    T[name + '.q'] = q
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


# ------------------------------------------------------------------ Bild
vm = CLIPVisionModelWithProjection.from_pretrained('openai/clip-vit-base-patch32').eval()
vc = vm.config
V = vm.vision_model
quant('v.patch', V.embeddings.patch_embedding.weight)  # [768, 3*32*32]
f32('v.cls', V.embeddings.class_embedding)
f32('v.pos', V.embeddings.position_embedding.weight)
norm('v.pre', V.pre_layrnorm)
for i, L in enumerate(V.encoder.layers):
    p = f'v.{i}.'
    norm(p + 'ln1', L.layer_norm1)
    linear(p + 'q', L.self_attn.q_proj)
    linear(p + 'k', L.self_attn.k_proj)
    linear(p + 'v', L.self_attn.v_proj)
    linear(p + 'o', L.self_attn.out_proj)
    norm(p + 'ln2', L.layer_norm2)
    linear(p + 'fc1', L.mlp.fc1)
    linear(p + 'fc2', L.mlp.fc2)
norm('v.post', V.post_layernorm)
quant('v.proj', vm.visual_projection.weight)
assert vc.hidden_act == 'quick_gelu', vc.hidden_act

# ------------------------------------------------------------------ Text
st = SentenceTransformer('sentence-transformers/clip-ViT-B-32-multilingual-v1', device='cpu')
mods = list(st)
hf = mods[0].auto_model.eval()
tok = mods[0].tokenizer
pool = mods[1]
dense = mods[2]
assert pool.pooling_mode_mean_tokens and not pool.pooling_mode_cls_token, 'mean pooling erwartet'
assert type(dense.activation_function).__name__ == 'Identity', dense.activation_function
tc = hf.config
assert tc.model_type == 'distilbert', tc.model_type
assert tc.activation == 'gelu', tc.activation
assert getattr(tok, 'do_lower_case', False) is False, 'Kleinschreibung nicht erwartet'

# Wortliste kürzen: nur Wörter aus lateinischer Schrift (plus Sonderzeichen-Bereiche)
vocab = [None] * len(tok.vocab)
for w, i in tok.vocab.items():
    vocab[i] = w


def latin(ch):
    o = ord(ch)
    return o < 0x250 or 0x1E00 <= o <= 0x1EFF or 0x2000 <= o <= 0x206F or 0x20A0 <= o <= 0x20CF


keep = [i for i, w in enumerate(vocab) if (w.startswith('[') and w.endswith(']')) or all(latin(c) for c in (w[2:] if w.startswith('##') else w))]
remap = {old: new for new, old in enumerate(keep)}
print(f'Wortliste: {len(vocab)} -> {len(keep)}')

E = hf.embeddings
quant('t.word', E.word_embeddings.weight[keep])
f32('t.pos', E.position_embeddings.weight)
norm('t.ln', E.LayerNorm)
for i, L in enumerate(hf.transformer.layer):
    p = f't.{i}.'
    linear(p + 'q', L.attention.q_lin)
    linear(p + 'k', L.attention.k_lin)
    linear(p + 'v', L.attention.v_lin)
    linear(p + 'o', L.attention.out_lin)
    norm(p + 'ln1', L.sa_layer_norm)
    linear(p + 'fc1', L.ffn.lin1)
    linear(p + 'fc2', L.ffn.lin2)
    norm(p + 'ln2', L.output_layer_norm)
linear('t.proj', dense.linear)

words = '\n'.join(vocab[i] for i in keep).encode('utf-8')
T['vocab'] = np.frombuffer(words, dtype=np.uint8).copy()

meta = {
    'format': 'slimsort-ki-1',
    'v_layers': str(len(V.encoder.layers)), 'v_heads': str(vc.num_attention_heads), 'v_dim': str(vc.hidden_size),
    'v_patch': str(vc.patch_size), 'v_size': str(vc.image_size), 'v_eps': str(vc.layer_norm_eps),
    't_layers': str(len(hf.transformer.layer)), 't_heads': str(tc.n_heads), 't_dim': str(tc.dim),
    't_max': str(tc.max_position_embeddings), 't_eps': '1e-12',
    'unk': str(remap[tok.vocab['[UNK]']]), 'cls': str(remap[tok.vocab['[CLS]']]), 'sep': str(remap[tok.vocab['[SEP]']]),
    'embed_dim': str(vm.visual_projection.out_features),
    'license': 'CLIP ViT-B/32 (MIT, OpenAI); clip-ViT-B-32-multilingual-v1 (Apache-2.0, sentence-transformers)',
}
save_file(T, os.path.join(OUT, 'slimsort-ki-1.safetensors'), metadata=meta)

# ------------------------------------------------------------------ Vergleichswerte
MEAN = np.array([0.48145466, 0.4578275, 0.40821073], dtype=np.float32)
STD = np.array([0.26862954, 0.26130258, 0.27577711], dtype=np.float32)


def pattern(kind):
    y, x = np.mgrid[0:224, 0:224]
    if kind == 'red':
        return np.stack([np.full_like(x, 230), np.full_like(x, 30), np.full_like(x, 30)], -1)
    if kind == 'blue':
        return np.stack([np.full_like(x, 30), np.full_like(x, 60), np.full_like(x, 220)], -1)
    return np.stack([(x * 3 + y * 5) % 256, (x * y) % 256, (x + 2 * y) % 256], -1)


def img_embed(rgb):
    a = (rgb.astype(np.float32) / 255.0 - MEAN) / STD
    t = torch.from_numpy(a.transpose(2, 0, 1)[None].copy())
    e = vm(pixel_values=t).image_embeds[0].numpy()
    return (e / np.linalg.norm(e)).tolist()


texts = ['ein rotes Bild', 'a blue picture', 'Ein Baum links, eine Wiese und ein Berg', 'Hund am Strand', 'Größe, Straße! (Café) – naïve 2024?']
ref = {'images': {k: img_embed(pattern(k)) for k in ['red', 'blue', 'pattern']}, 'texts': {}}
for s in texts:
    ids = tok(s)['input_ids']
    e = st.encode([s], convert_to_numpy=True)[0]
    ref['texts'][s] = {'ids': [remap[i] for i in ids], 'embed': (e / np.linalg.norm(e)).tolist()}
json.dump(ref, open(os.path.join(OUT, 'slimsort-ki-1-ref.json'), 'w'))

im = np.array([ref['images'][k] for k in ['red', 'blue']])
for s in texts[:2]:
    print(s, im @ np.array(ref['texts'][s]['embed']))
print('Größe:', os.path.getsize(os.path.join(OUT, 'slimsort-ki-1.safetensors')) / 1e6, 'MB')
