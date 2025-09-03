from skimage import measure
import numpy as np


def measure_morphology(label_mask):
    # Get properties for each labelled object
    regions = measure.regionprops(label_mask, spacing=(1,1))

    # Initialize list to store morphology data
    morphology_data = []

    for region in regions:
        props = {}
        props['label'] = region.label
        props['area'] = region.area   
        props['bbox'] = region.bbox                    # pixel count
        props['perimeter'] = region.perimeter             # approximate perimeter
        props['centroid'] = region.centroid               # (y, x)
        props['major_axis_length'] = region.major_axis_length
        props['minor_axis_length'] = region.minor_axis_length
        props['feret_diameter_max'] = region.feret_diameter_max
        # Circularity: 4*pi*Area / Perimeter^2
        props['eccentricity '] = region.eccentricity 
        props['circularity'] = 4 * np.pi * region.area / (region.perimeter ** 2) if region.perimeter > 0 else 0
        # Equivalent diameter
        props['equivalent_diameter'] = region.equivalent_diameter
        # Solidity (Area / Convex Area)
        props['solidity'] = region.solidity
        
        morphology_data.append(props)
    
    return morphology_data