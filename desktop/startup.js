window.desktopStartup.onStatus(text => { document.getElementById('status').textContent = text; if (text.startsWith('起動できませんでした')) document.getElementById('retry').disabled = false; });
document.getElementById('retry').addEventListener('click', async function () { this.disabled = true; try { await window.desktopStartup.retry(); } finally { this.disabled = false; } });
