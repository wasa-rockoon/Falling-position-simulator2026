const path = require('node:path');
module.exports = {
    packagerConfig: {
        asar: true, executableName: 'WasaSimulator', icon: './favicon.ico',
        extraResource: [path.join(__dirname,'desktop/.staging/simulator')],
        ignore: value => {
            if (!value) return false;
            const relative=value.replace(/\\/g,'/');
            return !(/^\/desktop(?:$|\/(?:main\.js|navigation\.js|preload\.js|startup\.(?:html|js|css))$)/.test(relative) || /^\/(?:package\.json|node_modules)(?:\/|$)/.test(relative));
        }
    },
    makers: [
        {name:'@electron-forge/maker-squirrel',config:{name:'WasaSimulator',setupExe:'WasaSimulatorSetup.exe',setupIcon:path.join(__dirname,'favicon.ico')}},
        {name:'@electron-forge/maker-zip',platforms:['win32']}
    ]
};
