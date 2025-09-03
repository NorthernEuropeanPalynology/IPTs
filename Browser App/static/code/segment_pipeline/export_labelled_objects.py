import numpy as np
import os
from skimage import io, img_as_ubyte
import pandas as pd
from tqdm import tqdm

def export_labelled_objects(image : np.ndarray, label_mask : np.ndarray, morph_data : pd.DataFrame, dest_folder, prefix='object'):
    """
    Extract each labelled object from an image, put it on a white background, and save to files.
    More efficient: crops first, then masks within the bounding box.
    
    Parameters:
    -----------
    image : 2D or 3D ndarray
        Original grayscale (2D) or RGB (3D) image.
    label_mask : 2D ndarray
        Labelled mask where each object has a unique integer (0 = background).
    dest_folder : str
        Path to folder where files will be saved.
    prefix : str
        Prefix for saved filenames.
    """
    os.makedirs(dest_folder, exist_ok=True)
    labels = np.unique(label_mask)
    labels = labels[labels != 0]  # exclude background

    for lbl in tqdm(morph_data.to_dict(orient="records")):

        (y0, x0, y1, x1) = lbl['bbox']
        # Crop both the image and the label_mask in the bounding box
        cropped_img = image[y0:y1, x0:x1]
        cropped_mask = (label_mask[y0:y1, x0:x1] == lbl['label'])

        # Prepare white background
        if cropped_img.ndim == 2:  # grayscale
            background = np.ones_like(cropped_img) * 255
        else:  # RGB
            background = np.ones_like(cropped_img) * 255

        # Apply cropped mask
        background[cropped_mask] = cropped_img[cropped_mask]

        # Convert to uint8
        output_img = img_as_ubyte(background)

        # Save file
        filename = os.path.join(dest_folder, f"{prefix}_{lbl['label']}.png")
        io.imsave(filename, output_img)

    print(f"Exported {len(labels)} objects to {dest_folder}")