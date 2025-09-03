import numpy as np
from skimage import color


def hsv_threshold(img: np.ndarray, h_range=(0.0, 1.0), s_range=(0.0, 1.0), v_range=(0.0, 1.0)) -> np.ndarray:
    """Threshold an RGB image in HSV space. Returns binary mask."""
    if img.ndim == 2:
        hsv = np.stack([img, img, img], axis=-1)
        hsv = color.rgb2hsv(np.clip(hsv, 0, 255).astype(np.uint8))
    elif img.ndim == 3 and img.shape[-1] >= 3:
        # assume RGB
        # If grayscale-like, tile channels
        if img.shape[-1] == 3:
            rgb = img
        else:
            rgb = img[..., :3]
        hsv = color.rgb2hsv(rgb)
    else:
        raise ValueError("Unsupported image shape for HSV thresholding")

    h, s, v = hsv[...,0], hsv[...,1], hsv[...,2]
    mask = (h >= h_range[0]) & (h <= h_range[1]) & \
           (s >= s_range[0]) & (s <= s_range[1]) & \
           (v >= v_range[0]) & (v <= v_range[1])
    return mask
