from PIL import Image
from io import BytesIO
from lxml import etree
import numpy as np
import os
import math

def _to_uint8(arr: np.ndarray) -> np.ndarray:
    if arr.dtype == np.uint8:
        return arr
    a = arr.astype(np.float32)
    amin, amax = float(a.min()), float(a.max())
    if amax <= amin:
        return np.zeros_like(a, dtype=np.uint8)
    a = (a - amin) / (amax - amin)
    return (a * 255.0).clip(0, 255).astype(np.uint8)

def save_dzi_from_numpy(arr: np.ndarray, output_dir: str, base_name: str,
                        tile_size: int = 512, fmt: str = "jpg") -> str:
    """
    Write a Deep Zoom Image (DZI) pyramid for OpenSeadragon from a numpy array.
    - arr: shape (H,W), (H,W,3) or (H,W,4). Channels-last.
    """
    os.makedirs(output_dir, exist_ok=True)
    print(arr.ndim)
    # --- numpy -> PIL (channels-last) ---
    if arr.ndim == 2:        # grayscale
        im = Image.fromarray(_to_uint8(arr), mode="L")
    elif arr.ndim == 3 and arr.shape[-1] in (3, 4):
        im = Image.fromarray(_to_uint8(arr[..., :3]), mode="RGB")
    else:
        # try to coerce by squeezing and taking first channel if needed
        a = np.squeeze(arr)
        if a.ndim == 2:
            im = Image.fromarray(_to_uint8(a), mode="L")
        elif a.ndim == 3 and a.shape[-1] >= 3:
            im = Image.fromarray(_to_uint8(a[..., :3]), mode="RGB")
        else:
            raise ValueError(f"Unsupported array shape {arr.shape}")

    width, height = im.size

    # --- descriptor (.dzi) ---
    ext = fmt.lower()
    pil_fmt = "JPEG" if ext in ("jpg", "jpeg") else ext.upper()
    dzi_path = os.path.join(output_dir, f"{base_name}.dzi")
    with open(dzi_path, "w", encoding="utf-8") as f:
        f.write(
            f'<?xml version="1.0" encoding="UTF-8"?>\n'
            f'<Image TileSize="{tile_size}" Overlap="0" Format="{ext}" '
            f'xmlns="http://schemas.microsoft.com/deepzoom/2008">\n'
            f'  <Size Width="{width}" Height="{height}"/>\n'
            f'</Image>'
        )

    # --- tiles root ---
    tiles_dir = os.path.join(output_dir, f"{base_name}_files")
    os.makedirs(tiles_dir, exist_ok=True)

    # Deep Zoom level math: levels = ceil(log2(max)) + 1
    max_dim = max(width, height)
    max_level = int(math.ceil(math.log(max_dim, 2)))  # same as ceil(log2)
    num_levels = max_level + 1

    # Helper: level dimensions with CEIL (important!)
    def level_dims(level: int):
        scale = 2 ** (max_level - level)
        w = int(math.ceil(width / float(scale)))
        h = int(math.ceil(height / float(scale)))
        return w, h

    # Generate level folders 0..max_level (0 = smallest)
    for level in range(num_levels):
        w, h = level_dims(level)
        lvl_img = im.resize((w, h), Image.LANCZOS)

        level_dir = os.path.join(tiles_dir, str(level))
        os.makedirs(level_dir, exist_ok=True)

        cols = int(math.ceil(w / float(tile_size)))
        rows = int(math.ceil(h / float(tile_size)))

        for row in range(rows):
            y0 = row * tile_size
            y1 = min((row + 1) * tile_size, h)
            for col in range(cols):
                x0 = col * tile_size
                x1 = min((col + 1) * tile_size, w)
                tile = lvl_img.crop((x0, y0, x1, y1))
                tile_path = os.path.join(level_dir, f"{col}_{row}.{ext}")
                # JPEG needs RGB/L mode; PNG fine either way
                save_kwargs = {"quality": 90} if pil_fmt == "JPEG" else {}
                tile.save(tile_path, pil_fmt, **save_kwargs)

    return dzi_path