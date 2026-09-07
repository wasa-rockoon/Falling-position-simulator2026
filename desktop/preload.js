const {contextBridge, ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktopStartup', {
    onStatus: callback => ipcRenderer.on('desktop:status', (_event, text) => callback(String(text))),
    retry: () => ipcRenderer.invoke('desktop:retry')
});
