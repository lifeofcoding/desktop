import { ipcRenderer, remote, webFrame, ipcMain } from 'electron';
import { readFileSync } from 'fs';
import { join } from 'path';
import { getAPI } from '~/shared/utils/extensions';
import { format, parse } from 'url';
import { IpcExtension } from '~/shared/models';
import { runInThisContext } from 'vm';
import console = require('console');

/* Deprecated */
// webFrame.registerURLSchemeAsPrivileged('extension');

// webFrame.executeJavaScript('window', false, w => {
//   w.chrome = {
//     webstorePrivate: {
//       install: () => {},
//     },
//     app: {
//       isInstalled: false,
//       getIsInstalled: () => {
//         return false;
//       },
//       getDetails: () => {},
//       installState: () => {},
//     },
//   };
// });

const tabId = parseInt(
  process.argv.find(x => x.startsWith('--tab-id=')).split('=')[1],
  10,
);

const goBack = () => {
  ipcRenderer.send('browserview-call', {
    tabId,
    scope: 'webContents.goBack',
  });
};

const goForward = () => {
  ipcRenderer.send('browserview-call', {
    tabId,
    scope: 'webContents.goForward',
  });
};

window.addEventListener('mouseup', e => {
  if (e.button === 3) {
    goBack();
  } else if (e.button === 4) {
    goForward();
  }
});

if (window.location.href == 'http://127.0.0.1:4444/newtab.html') {
  console.log('executing js');
  webFrame.executeJavaScript('window', false, (w: any) => {
    console.log('executed js');
    w.settings = ipcRenderer.sendSync('get-settings-sync');
  });

  window.addEventListener(
    'message',
    event => {
      ipcRenderer.send(`dot-${event.data}`);
    },
    false,
  );

  ipcRenderer.on('settings-push', (event: any, data: any) => {
    webFrame.executeJavaScript('window', false, (w: any) => {
      console.log('recieved settings push from', data);
      w.settings = ipcRenderer.sendSync('get-settings-sync');

      if (w.settings) {
        console.log(event.data, w.settings.uiTheme);
        if (w.settings.uiTheme == 'dark') {
          console.log('dark');
          document
            .getElementById('app')
            .firstElementChild.classList.remove('theme-light');
          document
            .getElementById('app')
            .firstElementChild.classList.add('theme-dark');
        } else {
          console.log('light');
          document
            .getElementById('app')
            .firstElementChild.classList.add('theme-light');
          document
            .getElementById('app')
            .firstElementChild.classList.remove('theme-dark');
        }
      }
    });
  });
}

let beginningScrollLeft: number = null;
let beginningScrollRight: number = null;
let horizontalMouseMove = 0;
let verticalMouseMove = 0;

const resetCounters = () => {
  beginningScrollLeft = null;
  beginningScrollRight = null;
  horizontalMouseMove = 0;
  verticalMouseMove = 0;
};

function getScrollStartPoint(x: number, y: number) {
  let left = 0;
  let right = 0;

  let n = document.elementFromPoint(x, y);

  while (n) {
    if (n.scrollLeft !== undefined) {
      left = Math.max(left, n.scrollLeft);
      right = Math.max(right, n.scrollWidth - n.clientWidth - n.scrollLeft);
    }
    n = n.parentElement;
  }
  return { left, right };
}

document.addEventListener('wheel', e => {
  verticalMouseMove += e.deltaY;
  horizontalMouseMove += e.deltaX;

  if (beginningScrollLeft === null || beginningScrollRight === null) {
    const result = getScrollStartPoint(e.deltaX, e.deltaY);
    beginningScrollLeft = result.left;
    beginningScrollRight = result.right;
  }
});

ipcRenderer.on('scroll-touch-end', () => {
  if (
    horizontalMouseMove - beginningScrollRight > 150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollRight < 10) {
      goForward();
    }
  }

  if (
    horizontalMouseMove + beginningScrollLeft < -150 &&
    Math.abs(horizontalMouseMove / verticalMouseMove) > 2.5
  ) {
    if (beginningScrollLeft < 10) {
      goBack();
    }
  }

  resetCounters();
});

// const runStylesheet = (url: string, code: string) => {
//   const wrapper = `((code) => {
//     function init() {
//       const styleElement = document.createElement('style');
//       styleElement.textContent = code;
//       document.head.append(styleElement);
//     }
//     document.addEventListener('DOMContentLoaded', init);
//   })`;

//   const compiledWrapper = runInThisContext(wrapper, {
//     filename: url,
//     lineOffset: 1,
//     displayErrors: true,
//   });

//   return compiledWrapper.call(window, code);
// };

// const injectContentScript = (script: any, extension: IpcExtension) => {
//   if (
//     !script.matches.some((x: string) =>
//       matchesPattern(
//         x,
//         `${location.protocol}//${location.host}${location.pathname}`,
//       ),
//     )
//   ) {
//     return;
//   }

//   process.setMaxListeners(0);

//   if (script.js) {
//     script.js.forEach((js: any) => {
//       const fire = runContentScript.bind(
//         window,
//         js.url,
//         js.code,
//         extension,
//         getIsolatedWorldId(extension.id),
//       );

//       if (script.runAt === 'document_start') {
//         (process as any).once('document-start', fire);
//       } else if (script.runAt === 'document_end') {
//         (process as any).once('document-end', fire);
//       } else {
//         document.addEventListener('DOMContentLoaded', fire);
//       }
//     });
//   }

//   if (script.css) {
//     script.css.forEach((css: any) => {
//       const fire = runStylesheet.bind(window, css.url, css.code);
//       if (script.runAt === 'document_start') {
//         (process as any).once('document-start', fire);
//       } else if (script.runAt === 'document_end') {
//         (process as any).once('document-end', fire);
//       } else {
//         document.addEventListener('DOMContentLoaded', fire);
//       }
//     });
//   }
// };

// let nextIsolatedWorldId = 1000;
// const isolatedWorldsRegistry: any = {};

// const getIsolatedWorldId = (id: string) => {
//   if (isolatedWorldsRegistry[id]) {
//     return isolatedWorldsRegistry[id];
//   }
//   nextIsolatedWorldId++;
//   return (isolatedWorldsRegistry[id] = nextIsolatedWorldId);
// };

// const setImmediateTemp: any = setImmediate;

// process.once('loaded', () => {
//   global.setImmediate = setImmediateTemp;

//   const extensions: { [key: string]: IpcExtension } = ipcRenderer.sendSync(
//     'get-extensions',
//   );

//   Object.keys(extensions).forEach(key => {
//     const extension = extensions[key];
//     const { manifest } = extension;

//     if (manifest.content_scripts) {
//       const readArrayOfFiles = (relativePath: string) => ({
//         url: `extension://${extension.id}/${relativePath}`,
//         code: readFileSync(join(extension.path, relativePath), 'utf8'),
//       });

//       try {
//         manifest.content_scripts.forEach(script => {
//           const newScript = {
//             matches: script.matches,
//             js: script.js ? script.js.map(readArrayOfFiles) : [],
//             css: script.css ? script.css.map(readArrayOfFiles) : [],
//             runAt: script.run_at || 'document_idle',
//           };

//           injectContentScript(newScript, extension);
//         });
//       } catch (readError) {
//         console.error('Failed to read content scripts', readError);
//       }
//     }
//   });
// });
