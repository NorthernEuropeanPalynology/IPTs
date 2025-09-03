import numpy as np
from scipy import ndimage as ndi
from skimage import measure, morphology, filters, segmentation, feature
from . import hsv_threshold, measure_morphology, filter_objects
from typing import Tuple
import pandas as pd

def segment(img_roi: np.ndarray,
                     h_range=(0.0, 1.0),
                     s_range=(0.0, 1.0),
                     v_range=(0.0, 1.0),
                     min_size: int = 50,
                     min_distance : int = 45,
                     dilate_iters: int = 1,
                     smooth_radius: int = 0,
                     do_watershed: bool = True,
                     do_morphology: bool = True,
                     gaussian_sigma: float = 0.0,
                     **morphfilter) -> Tuple[np.ndarray, np.ndarray]:
    """Run the full segmentation pipeline inside an ROI.

    Returns: labels (int32), mask (bool)
    """
    get = morphfilter["morphfilter"].get
    filters = [
        ("area", get("minArea"), get("maxArea")),
        ("circularity", get("minCircularity"), get("maxCircularity")),
        ("equivalent_diameter", get("minEqDiameter"), get("maxEqDiameter")),
        # add more here...
    ]

    # 1) HSV threshold
    mask = hsv_threshold(img_roi, h_range, s_range, v_range)

    # optional blur before morphology to smooth edges
    if gaussian_sigma and gaussian_sigma > 0:
        if mask.dtype != np.float32:
            mask = mask.astype(float)
        mask = filters.gaussian(mask, sigma=gaussian_sigma) > 0.5

    # 5) Dilate to enlarge
    if dilate_iters and dilate_iters > 0:
        mask = morphology.dilation(mask, morphology.disk(3))
        for _ in range(dilate_iters-1):
            mask = morphology.dilation(mask, morphology.disk(3))

    # 2) Fill holes
    mask = ndi.binary_fill_holes(mask)

    # 3) Remove small grains
    mask = morphology.remove_small_objects(mask, min_size=max(1, int(min_size)))

    # 4) Smooth contours (opening then closing with disk)
    if smooth_radius and smooth_radius > 0:
        selem = morphology.disk(int(smooth_radius))
        mask = morphology.opening(mask, selem)
        mask = morphology.closing(mask, selem)

    # 6) Separate touching objects (watershed)
    if do_watershed:
        distance = ndi.distance_transform_edt(mask)
        # Peaks for watershed markers
        coords = feature.peak_local_max(distance, labels=mask, footprint=np.ones((3,3)), min_distance=min_distance)
        peak_mask = np.zeros(distance.shape, dtype=bool)
        peak_mask[tuple(coords.T)] = True
        markers, _ = ndi.label(peak_mask)
        labels = segmentation.watershed(-distance, markers, mask=mask)
    else:
        labels = measure.label(mask)
    print("watershed done!")
    morphologies = measure_morphology(labels)
    morphology_data = pd.DataFrame((morphologies))
    filtered_labels = labels

    if do_morphology:
        passed, _ = filter_objects(morphologies, filters)
        print("morphology filter done")
        # Create a boolean mask of pixels to keep
        keep_mask = np.isin(labels, np.array(passed))
        #TODO draw objects which are not accepted
        rejected_mask = np.isin(labels, np.array(passed), invert = True)
        filtered_labels = labels * keep_mask

        #Filter morphology_data for filtered objects
        morphology_data = morphology_data[morphology_data["label"].isin(passed)]

    return filtered_labels.astype(np.int32, copy=False), labels.astype(np.int32, copy=False), mask.astype(bool, copy=False), morphology_data