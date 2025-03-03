import { observable, computed, action } from 'mobx';
import * as React from 'react';
import { ipcRenderer, webContents } from 'electron';
import * as Vibrant from 'node-vibrant';
import { remote } from 'electron';

import store from '~/renderer/app/store';
import {
  TABS_PADDING,
  TOOLBAR_HEIGHT,
  defaultTabOptions,
  TAB_ANIMATION_DURATION,
} from '~/renderer/app/constants';
import { closeWindow, getColorBrightness } from '../utils';
import { colors } from '~/renderer/constants';
import { makeId } from '~/shared/utils/string';
import { setInterval } from 'timers';
import { ClosedTabs } from './closed-tabs';
import console = require('console');

let id = 1;

export class Tab {
  @observable
  public id: number = id++;

  @observable
  public isDragging: boolean = false;

  @observable
  public title: string = 'New tab';

  @observable
  public originalTitle: string = 'New tab';

  @observable
  public loading: boolean = false;

  @observable
  public favicon: string = '';

  @observable
  public tabGroupId: number;

  @observable
  public width: number = 0;

  @observable
  public position = 0;

  @observable
  public isUrlVisible: boolean = false;

  @observable
  public background: string = colors.blue['500'];

  @observable
  public url = '';

  @observable
  private _findVisible = false;

  @observable
  public findOccurrences = '0/0';

  @observable
  public findText = '';

  @observable
  public blockedAds = 0;

  @observable
  public f = 0;

  @observable
  public closedTabs: ClosedTabs[] = [];

  @observable
  public zoomAmount: number = 1;

  @observable
  public screenshot: any = '';

  @computed
  public get findVisible() {
    return this._findVisible;
  }

  public webContents() {
    return remote.webContents.fromId(this.webContentsId);
  }

  public muteTab() {
    if (this.audioPlaying == true) {
      ipcRenderer.send('audio-pause');
      this.audioPlaying = false;
    } else {
      ipcRenderer.send('audio-resume');
      this.audioPlaying = true;
    }
  }

  public set findVisible(val: boolean) {
    this._findVisible = val;

    if (val) {
      ipcRenderer.send('window-focus');
    }

    requestAnimationFrame(() => {
      store.tabs.updateTabsBounds(true);
      if (val && store.findInputRef.current) {
        store.findInputRef.current.focus();
      }
    });
  }

  @computed
  public get isSelected() {
    return store.tabGroups.currentGroup.selectedTabId === this.id;
  }

  @computed
  public get isHovered() {
    return store.tabs.hoveredTabId === this.id;
  }

  @computed
  public get borderVisible() {
    const tabs = this.tabGroup.tabs
      .slice()
      .sort((a, b) => a.position - b.position);

    const i = tabs.indexOf(this);
    const nextTab = tabs[i + 1];

    if (
      (nextTab && (nextTab.isHovered || nextTab.isSelected)) ||
      this.isSelected ||
      this.isHovered
    ) {
      return false;
    }

    return true;
  }

  @computed
  public get isExpanded() {
    return this.isHovered || this.isSelected || !store.tabs.scrollable;
  }

  @computed
  public get isIconSet() {
    return this.favicon !== '' || this.loading;
  }

  public left = 0;
  public tempPosition = 0;
  public lastUrl: any = [];
  public isClosing = false;
  public ref = React.createRef<HTMLDivElement>();
  public lastHistoryId: string;
  public hasThemeColor = false;
  public webContentsId: number;
  public findRequestId: number;
  public isWindow: boolean = false;
  public audioPlaying: boolean = false;

  constructor({ url, active } = defaultTabOptions, tabGroupId: number) {
    this.tabGroupId = tabGroupId;

    this.position = this.tabGroup.nextPosition++;
    this.tempPosition = this.position;

    if (new URL(url).hostname === 'localhost') {
      const newURL = new URL(url);
      newURL.hostname = '127.0.0.1';
      url = newURL.href;
    }

    ipcRenderer.send('browserview-create', { tabId: this.id, url });

    ipcRenderer.once(`browserview-created-${this.id}`, (e: any, id: number) => {
      this.webContentsId = id;
      if (active) {
        this.select();
      }
    });

    ipcRenderer.on(
      `browserview-data-updated-${this.id}`,
      async (e: any, { title, url }: any) => {
        let updated = null;

        if (url !== this.url) {
          if (url.includes('ssl-error.html?du=') == false) {
            this.lastHistoryId = await store.history.addItem({
              title: this.title,
              url,
              favicon: this.favicon,
              date: new Date().toString(),
            });

            updated = {
              url,
            };
          }
        }

        if (title !== this.title) {
          updated = {
            title,
          };
        }

        if (updated) {
          this.emitOnUpdated(updated);
        }

        this.title = title;
        this.url = url;

        this.updateData();
      },
    );

    ipcRenderer.on(
      `load-commit-${this.id}`,
      (
        e: any,
        event: any,
        url: string,
        isInPlace: boolean,
        isMainFrame: boolean,
      ) => {
        if (isMainFrame) {
          this.blockedAds = 0;
        }
      },
    );

    ipcRenderer.on(
      `browserview-favicon-updated-${this.id}`,
      async (e: any, favicon: string) => {
        try {
          this.favicon = favicon;

          const fav = await store.favicons.addFavicon(favicon);
          const buf = Buffer.from(fav.split('base64,')[1], 'base64');

          if (!this.hasThemeColor) {
            const palette = await Vibrant.from(buf).getPalette();

            if (!palette.Vibrant) return;

            if (getColorBrightness(palette.Vibrant.hex) < 170) {
              console.log(palette.DarkVibrant.hex, palette.Vibrant.hex);
              this.background =
                store.options.theme == 'light'
                  ? palette.Vibrant.hex
                  : palette.DarkVibrant.hex;
            } else {
              this.background = colors.blue['500'];
            }
          }
        } catch (e) {
          this.favicon = '';
          this.background = colors.blue['500'];
        }
        this.updateData();
      },
    );

    ipcRenderer.on(`blocked-ad-${this.id}`, () => {
      this.blockedAds++;
    });

    ipcRenderer.on(
      `browserview-theme-color-updated-${this.id}`,
      (e: any, themeColor: string) => {
        if (themeColor && getColorBrightness(themeColor) < 170) {
          this.background = themeColor;
          this.hasThemeColor = true;
        } else {
          this.background = colors.blue['500'];
          this.hasThemeColor = false;
        }
      },
    );

    ipcRenderer.on(`view-loading-${this.id}`, (e: any, loading: boolean) => {
      this.loading = loading;

      this.emitOnUpdated({
        status: loading ? 'loading' : 'complete',
      });
    });

    ipcRenderer.on(`audio-playing-${this.id}`, (e: any) => {
      this.select();
      this.originalTitle = this.title;
      this.audioPlaying = true;
    });

    ipcRenderer.on(`audio-stopped-${this.id}`, (e: any) => {
      this.select();
      this.audioPlaying = false;
      this.title = this.originalTitle;
    });

    const { defaultBrowserActions, browserActions } = store.extensions;

    for (const item of defaultBrowserActions) {
      const browserAction = { ...item };
      browserAction.tabId = this.id;
      browserActions.push(browserAction);
    }
  }

  @action
  public updateData() {
    if (this.lastHistoryId) {
      const { title, url, favicon } = this;

      const item = store.history.getById(this.lastHistoryId);

      if (item) {
        item.title = title;
        item.url = url;
        item.favicon = favicon;
      }

      store.history.db.update(
        {
          _id: this.lastHistoryId,
        },
        {
          $set: {
            title,
            url,
            favicon,
          },
        },
      );
    }
  }

  public get tabGroup() {
    return store.tabGroups.getGroupById(this.tabGroupId);
  }

  @action
  public select() {
    if (!this.isClosing) {
      store.canToggleMenu = this.isSelected;

      this.tabGroup.selectedTabId = this.id;

      ipcRenderer.send('browserview-select', this.id);

      store.tabs.emitEvent('onActivated', {
        tabId: this.id,
        windowId: 0,
      });

      requestAnimationFrame(() => {
        store.tabs.updateTabsBounds(true);
      });
    }
  }

  public getWidth(containerWidth: number = null, tabs: Tab[] = null) {
    if (containerWidth === null) {
      containerWidth = store.tabs.containerWidth;
    }

    if (tabs === null) {
      tabs = store.tabs.list.filter(
        x => x.tabGroupId === this.tabGroupId && !x.isClosing,
      );
    }

    const width = containerWidth / tabs.length - TABS_PADDING;

    if (width > 200) {
      return 200;
    }
    if (width < 72) {
      return 72;
    }

    return width;
  }

  public getLeft(reordering: boolean = false, calcNewLeft: boolean = false) {
    const tabs = this.tabGroup.tabs.slice();

    if (reordering) {
      tabs.sort((a, b) => a.tempPosition - b.tempPosition);
    } else {
      tabs.sort((a, b) => a.position - b.position);
    }

    const index = tabs.indexOf(this);

    let left = 0;
    for (let i = 0; i < index; i++) {
      left += (calcNewLeft ? this.getWidth() : tabs[i].width) + TABS_PADDING;
    }

    return left;
  }

  @action
  public setLeft(left: number, animation: boolean) {
    store.tabs.animateProperty('x', this.ref.current, left, animation);
    this.left = left;
  }

  @action
  public setWidth(width: number, animation: boolean) {
    store.tabs.animateProperty('width', this.ref.current, width, animation);
    this.width = width;
  }

  @action
  public hardReload() {
    ipcRenderer.send('browserview-destroy', this.id);
  }

  @action
  public close() {
    const tabGroup = this.tabGroup;
    const tabs = tabGroup.tabs.slice().sort((a, b) => a.position - b.position);

    store.tabs.lastUrl.push(this.url);

    const selected = tabGroup.selectedTabId === this.id;

    ipcRenderer.send('browserview-destroy', this.id);

    const notClosingTabs = tabs.filter(x => !x.isClosing);
    let index = notClosingTabs.indexOf(this);

    store.tabs.resetRearrangeTabsTimer();

    this.isClosing = true;
    if (notClosingTabs.length - 1 === index) {
      const previousTab = tabs[index - 1];
      if (previousTab) {
        this.setLeft(previousTab.getLeft(false, true) + this.getWidth(), true);
      }
      store.tabs.updateTabsBounds(true);
    }

    this.setWidth(0, true);
    store.tabs.setTabsLefts(true);

    if (selected) {
      index = tabs.indexOf(this);

      if (
        index + 1 < tabs.length &&
        !tabs[index + 1].isClosing &&
        !store.tabs.scrollable
      ) {
        const nextTab = tabs[index + 1];
        nextTab.select();
      } else if (index - 1 >= 0 && !tabs[index - 1].isClosing) {
        const prevTab = tabs[index - 1];
        prevTab.select();
      } else if (store.tabGroups.list.length === 1) {
        remote.app.quit();
      } else if (this.tabGroup.tabs.length === 0) {
        remote.app.quit();
      }
    }

    setTimeout(() => {
      store.tabs.removeTab(this.id);
    }, TAB_ANIMATION_DURATION * 1000);
  }

  public emitOnUpdated = (data: any) => {
    store.tabs.emitEvent('onUpdated', this.id, data, this.getApiTab());
  };

  callViewMethod = (scope: string, ...args: any[]): Promise<any> => {
    return new Promise(resolve => {
      const callId = makeId(32);
      ipcRenderer.send('browserview-call', {
        args,
        scope,
        tabId: this.id,
        callId,
      });

      ipcRenderer.once(
        `browserview-call-result-${callId}`,
        (e: any, result: any) => {
          resolve(result);
        },
      );
    });
  };

  public getApiTab(): chrome.tabs.Tab {
    const selected = this.isSelected;

    return {
      id: this.id,
      index: this.tabGroup.tabs.indexOf(this),
      title: this.title,
      pinned: false,
      favIconUrl: this.favicon,
      url: this.url,
      status: this.loading ? 'loading' : 'complete',
      width: this.width,
      height: TOOLBAR_HEIGHT,
      active: selected,
      highlighted: selected,
      selected,
      windowId: 0,
      discarded: false,
      incognito: false,
      autoDiscardable: false,
    };
  }
}
