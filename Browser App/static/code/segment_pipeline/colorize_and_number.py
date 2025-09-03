import numpy as np
from skimage import measure
from PIL import Image, ImageDraw, ImageFont
from matplotlib import cm
import pandas as pd
from tqdm import tqdm

def make_overlay_png(
    labels: np.ndarray,
    prop_data : pd.DataFrame,
    mask: np.ndarray | None = None,
    alpha: int = 100,                 # 0..255 transparency for colored regions
    cmap_name: str = "tab20",
    number_color=(0, 0, 0, 255),      # RGBA for label numbers
    out_path: str | None = None,
    draw_numbers: bool = True,
):
    """
    Create a transparent RGBA overlay (PNG) with colored regions and numbers.
    - labels: HxW int array (0 = background)
    - mask:   optional HxW bool/int array (nonzero keeps, zero clears)
    - Returns: PIL.Image in RGBA; also saves to out_path if provided
    """
    H, W = labels.shape
    rgba = np.zeros((H, W, 4), dtype=np.uint8)  # fully transparent canvas

    # Unique labels, skip background 0
    objs = [int(v) for v in np.unique(labels) if v != 0]
    if not objs:
        img = Image.fromarray(rgba, mode="RGBA")
        if out_path: img.save(out_path, format="PNG")
        return img

    K = len(objs)
    # colors for all objects at once: (K, 3) in uint8
    colors = (255 * cm.get_cmap(cmap_name, K)(np.arange(K))[:, :3]).astype(np.uint8)

    # Build LUT up to max label id; fill only the labels we care about
    max_lab = int(labels.max())
    lut = np.zeros((max_lab + 1, 4), dtype=np.uint8)  # RGBA
    lut[0, 3] = 0                               # background alpha
    lut[objs, :3] = colors                             # RGB per object
    lut[objs, 3]  = alpha                             # same alpha for all objects

    # One-shot mapping: (H, W, 4)
    rgba = lut[labels]                        # A

    # Apply optional mask: zero-out where mask is false
    if mask is not None:
        keep = mask.astype(bool)
        rgba[~keep] = 0

    # Draw numbers at centroids
    img = Image.fromarray(rgba, mode="RGBA")
    draw = ImageDraw.Draw(img)
    try:
        # You can point to a TTF if you want nicer text
        font = ImageFont.load_default(size=30)
    except Exception:
        font = None

    if draw_numbers:
        for prop in tqdm(prop_data.to_dict(orient="records")):
            if prop['label'] == 0:
                continue
            y, x = prop['centroid']  # (row, col)
            xy = (float(x), float(y))

            draw.text(xy, str(prop['label']), fill=number_color, font=font, anchor="mm")

    if out_path:
        img.save(out_path, format="PNG", quality=50)

    return img
