def filter_objects(morphology_data, 
                   range_filter):
    """
    Filter Objects based on morphological descriptions

    Parameters:
    -----------
    morphology_data : list
        Table of morphological data including label
    minArea, maxArea : int
        Defining the min and maxArea of objects of interest
    minCircularity, maxCircularity : float
        Defining range for circularity between 0 and 1
    minEqDiameter, maxEqDiameter : float
        Defining range for eq. diameter
    """

    passed, description = [], []

    for row in morphology_data:
        measurement = {}
        measurement['label'] = row['label']

        pass_filter = True

        for filter in range_filter:
            fname = filter[0]
            val = row[fname]
            lo = filter[1]
            hi = filter[2]

            if (lo is None or val >= lo):
                if (hi is None or val <=hi):
                    measurement['status'] = "pass"

                else:
                    measurement['status'] = "fail: {}: {} > {} ".format(fname, round(val, 2), hi)
                    pass_filter = False
            else:
                measurement['status'] = "fail: {}: {} < {} ".format(fname, round(val, 2), lo)
                pass_filter = False

        if pass_filter:
            passed.append(row['label'])

        description.append(measurement)

    return passed, description