from fastapi import FastAPI, UploadFile, HTTPException
from fastapi.staticfiles import StaticFiles

from fastapi.responses import JSONResponse, FileResponse, Response, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
from nd2 import ND2File
from typing import List, Tuple, Optional
from pathlib import Path
from pydantic import BaseModel, Field, model_validator

import cv2
import os

from static.code import segment_pipeline, build_pyramid

import uvicorn
import tempfile

from matplotlib import cm
from PIL import Image
import pandas as pd
import io
import zipfile 

Image.MAX_IMAGE_PIXELS = 500000000

class NoStoreStaticFiles(StaticFiles):
    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        # Never cache masks
        response.headers["Cache-Control"] = "no-store"
        # Optionally:
        # response.headers["Pragma"] = "no-cache"
        # response.headers["Expires"] = "0"
        return response


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_methods=["GET"],   # or ["*"] if you prefer
    allow_headers=["*"],
    allow_credentials=False, # keep False if allow_origins isn't a specific site with cookies
)

# Serve the `static` folder containing your index.html + JS + CSS
app.mount("/static", StaticFiles(directory="static"), name="static")
app.mount("/dzi", StaticFiles(directory="cache/dzi/"), name="dzi")
app.mount("/png", StaticFiles(directory="cache/png/"), name="png")
app.mount("/export", StaticFiles(directory="cache/export/", html= True), name="export")
app.mount("/mask", NoStoreStaticFiles(directory="cache/mask/", check_dir = True), name="mask")

@app.get("/")
async def main_page():
    return FileResponse("./index.html")


@app.get("/fetch_dzi")
def fetch_dzi():
    base = os.path.join("cache", "dzi")
    dzi_files = [
        f for f in os.listdir(base)
        if f.endswith(".dzi") and os.path.isfile(os.path.join(base, f))
    ]
    return {"files": dzi_files}


class SegmentPayload(BaseModel):
    data: Optional[List[int]] = Field(None, description="Flattened RGBA bytes")
    width: Optional[int] = None
    height: Optional[int] = None
    image_path: Optional[Path] = Field(None, description="Path to a PNG/JPEG/etc.")
    h_min: float
    h_max: float
    s_min: float
    s_max: float
    v_min: float
    v_max: float
    do_watershed: bool
    do_morphology: bool
    min_distance: int = 45
    dilate: int = 1
    smooth_radius: int = 0
    filename: str
    morphfilter: dict

    @model_validator(mode="after")
    def _validate_inputs(self):
        if (self.data is None) == (self.image_path is None):
            raise ValueError("Provide exactly one of: (data + width + height) OR image_path")

        if self.data is not None:
            if self.width is None or self.height is None:
                raise ValueError("When sending data, width and height are required.")
            expected = self.width * self.height * 4
            if len(self.data) != expected:
                raise ValueError(f"'data' length {len(self.data)} != width*height*4 ({expected})")
        return self

    def to_image(self) -> Image.Image:
        """Return a PIL RGBA image regardless of input mode."""
        if self.image_path is not None:
            print(Path("cache") / self.image_path)
            img = Image.open(Path("cache/png") / self.image_path.name).convert("RGBA")
            # backfill size so downstream code can rely on it
            self.width, self.height = img.size
            return np.asarray(img)

          # Rebuild RGBA image
        arr = np.asarray(self.data, dtype=np.uint8)
        expected = self.width * self.height * 4
        if arr.size != expected:
            return JSONResponse(
                {"error": f"Pixel data size mismatch. Got {arr.size}, expected {expected}."},
                status_code=400
            )

        rgba = arr.reshape((self.height, self.width, 4))

        return rgba

@app.post("/segment")
async def segment_image(payload: SegmentPayload):
    
    rgb = payload.to_image()
    print(payload.do_watershed)
    # Call your pipeline with mapped params
    filtered_labels, labels, mask, morphology_data = segment_pipeline.segment(
        img_roi=rgb,
        h_range=(payload.h_min, payload.h_max),
        s_range=(payload.s_min, payload.s_max),
        v_range=(payload.v_min, payload.v_max),
        min_distance = payload.min_distance,
        dilate_iters=payload.dilate,
        smooth_radius=payload.smooth_radius,
        do_morphology=payload.do_morphology,
        do_watershed=payload.do_watershed,
        morphfilter=payload.morphfilter
    )

    segment_pipeline.make_overlay_png(filtered_labels, morphology_data, out_path="./cache/mask/{}.png".format(payload.filename), alpha=200)

    #Store mask as np array and download the pandas data frame.
    np.save("cache/mask/tmp/{}.npy".format(payload.filename), filtered_labels)
    morphology_data.to_parquet("cache/mask/tmp/{}.parquet".format(payload.filename))

    return JSONResponse(content={"measurements" : morphology_data.to_dict(orient="records")})

@app.get("/morphology/{filename}")
def download_csv(filename: str):
    p = Path("cache/mask/tmp") / f"{filename}.parquet"
    if not p.exists():
        raise HTTPException(404, f"Not found: {p}")
    df = pd.read_parquet(p)  # needs pyarrow/fastparquet
    csv_text = df.to_csv(index=False)  # returns str
    return Response(
        content=csv_text,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}.csv"'},
    )

# 2) Save all extracted images using your pipeline
@app.get("/exportPollen/{filename}.zip")
def export_images(filename: str):
    mask_path = Path("cache/mask/tmp") / f"{filename}.npy"
    img_path  = Path("cache/png") / f"{filename}.png"
    p = Path("cache/mask/tmp") / f"{filename}.parquet"

    df = pd.read_parquet(p)
    mask = np.load(mask_path)
    im_array = np.asarray(Image.open(img_path))

    out_dir = Path("cache/export") / filename
    out_dir.mkdir(parents=True, exist_ok=True)

    segment_pipeline.export_labelled_objects(
        image=im_array,
        label_mask=mask,
        dest_folder=str(out_dir),
        morph_data=df
    )

    # Zip that folder and return as download
    mem = io.BytesIO()
    with zipfile.ZipFile(mem, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in out_dir.rglob("*"):
            if p.is_file():
                zf.write(p, arcname=p.relative_to(out_dir))
    mem.seek(0)
    return StreamingResponse(
        mem,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}.zip"'}
    )


@app.post("/upload_nd2")
async def upload_nd2(file: UploadFile):

    # 1. Read file into memory
    file_bytes = await file.read()

    # 2. Write to a temporary file because ND2File requires a file path
    with tempfile.NamedTemporaryFile(delete=False, suffix=".nd2") as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        # 3. Parse ND2 file to image data
        with ND2File(tmp_path) as nd2:
            arr = nd2.asarray()   # shape usually (T, Z, C, Y, X)
            arr_RGB = cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

        # 4. Build pyramid from image data
        output_dir = "cache/dzi/"
        os.makedirs(output_dir, exist_ok=True)

        base_name = os.path.splitext(file.filename)[0]
        dzi_path = build_pyramid.save_dzi_from_numpy(arr_RGB, output_dir, base_name)
        arr_RGBA = cv2.cvtColor(arr, cv2.COLOR_BGR2RGBA)
        im = Image.fromarray(np.uint8(arr_RGBA), mode="RGBA")
        im.save("cache/png/{}.png".format(base_name), format="PNG", quality = 95)

        return JSONResponse({"dzi_url": f"/dzi/{os.path.basename(dzi_path)}"})
    finally:
        # Clean up temp file
        os.remove(tmp_path)

# Run server if executed directly
if __name__ == "__main__":
    uvicorn.run("app:app", host="127.0.0.1", port=8000, reload=True)