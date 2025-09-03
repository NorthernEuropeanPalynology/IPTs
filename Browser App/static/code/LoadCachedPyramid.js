window.currentFile = "default"

document.getElementById("openFile").addEventListener("click", async () => {
  const response = await fetch("/fetch_dzi");
  const data = await response.json();

  const list = document.getElementById("fileList");
  list.innerHTML = "";

  data.files.forEach(file => {
    const li = document.createElement("li");
    li.textContent = file;
    li.style.cursor = "pointer";
    li.style.padding = "6px 0";
    li.style.borderBottom = "1px solid #ddd";

    li.addEventListener("click", () => {
      viewer.open(`/dzi/${file}`);
      document.getElementById("fileModal").style.display = "none"; // close modal
      document.getElementById("file-info").innerHTML = file;
      window.currentFile = file.replace(/\.[^/.]+$/, "");
    });

    list.appendChild(li);
  });

  document.getElementById("fileModal").style.display = "block";
});

// Close modal
document.getElementById("closeModal").addEventListener("click", () => {
  document.getElementById("fileModal").style.display = "none";
});