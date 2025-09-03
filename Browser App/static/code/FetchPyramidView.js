// OpenSeadragon viewer setup
window.viewer = OpenSeadragon({
    id: "viewer",
    prefixUrl: "https://cdnjs.cloudflare.com/ajax/libs/openseadragon/4.1.0/images/",
    tileSources: "dzi/default.dzi"
});

viewer.scalebar({
                    pixelsPerMeter: 1000000 / 0.24,
                    ScalebarLocation: "BOTTOM_LEF",
                    stayInsideImage: true,
                    color: "black",
                    fontColor: "black",
                    backgroundColor: "rgba(255,255,255,0.5)",
                    barThickness: 4
                });

initHSV(window.viewer)

const sampler = window.setupColorSampler({ buttonId: 'pipetteBtn', cursorRadius: 10 });

const nd2input = document.getElementById("nd2file");
const loadingOverlay = document.getElementById("loadingOverlay");
const progressBar = document.getElementById("progressBar");

nd2input.addEventListener("change", async () => {
    if (!nd2input.files.length) return;

    loadingOverlay.style.display = "flex";


    const file = nd2input.files[0];
    const formData = new FormData();
    formData.append("file", file);

    // Upload file to backend
    const res = await fetch("/upload_nd2", {
      method: "POST",
      body: formData
    });

    if (!res.ok) {
      alert("Error processing ND2 file!");
      loadingOverlay.style.display = "none";
      return;
    }

    // Optionally: backend streams progress (mock here)
    // You can replace with SSE/websocket for real progress updates
    let progress = 0;
    const interval = setInterval(() => {
      progress += 10;
      progressBar.value = progress;
      if (progress >= 100) {
        clearInterval(interval);
        finishLoading();
      }
    }, 300);

    async function finishLoading() {
      loadingOverlay.style.display = "none";

      // Assume backend returns URL of .dzi
      const data = await res.json();
      viewer.open(data.dzi_url);
      let filename = file.name
      filename = filename.replace(/\.[^/.]+$/, "")
      document.getElementById("file-info").innerHTML = filename.concat(".dzi");
      window.currentFile = filename;
    }
});
