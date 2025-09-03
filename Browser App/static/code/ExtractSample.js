
document.getElementById('exportCSV').addEventListener( 'click', async function downloadCSV() {
    const filename = window.currentFile;
    if (!filename) { alert('No current file selected'); return; }
    const url = `/morphology/${filename}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();

    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${filename}.csv`; // force name
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
});

document.getElementById('exportPollen').addEventListener('click', async () => {
  const filename = window.currentFile;
  if (!filename) { alert('No current file selected'); return; }

  const url = `/exportPollen/${filename}.zip`;
  const res = await fetch(url);
  if (!res.ok) { alert(`HTTP ${res.status}`); return; }

  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${filename}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
});