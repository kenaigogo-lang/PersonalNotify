import { createContext, useContext } from 'react';

export type ThemeName = 'nes' | 'arcade';

export const THEME_LABEL: Record<ThemeName, string> = {
  nes: '紅白機',
  arcade: '街機',
};

const STORAGE_KEY = 'personalnotify_theme';
const THEME_COLOR: Record<ThemeName, string> = {
  nes: '#212529',
  arcade: '#07060d',
};

export const loadTheme = (): ThemeName => {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'arcade' ? 'arcade' : 'nes';
  } catch {
    return 'nes';
  }
};

export const applyTheme = (theme: ThemeName) => {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme]);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // 忽略無痕模式儲存失敗
  }
};

const UI = {
  nes: {
    panel: 'nes-container is-rounded pn-panel',
    btn: 'nes-btn',
    btnPrimary: 'nes-btn is-primary',
    btnSuccess: 'nes-btn is-success',
    btnWarn: 'nes-btn is-warning',
    btnDanger: 'nes-btn is-error',
    input: 'nes-input',
    textarea: 'nes-textarea',
    selectWrap: 'nes-select pn-select',
  },
  arcade: {
    panel: 'pn-panel',
    btn: 'btn',
    btnPrimary: 'btn cy',
    btnSuccess: 'btn go',
    btnWarn: 'btn yw',
    btnDanger: 'btn rd',
    input: 'pn-input',
    textarea: 'pn-textarea',
    selectWrap: 'pn-select',
  },
};

export const ThemeContext = createContext<ThemeName>('nes');
export const useUi = () => UI[useContext(ThemeContext)];
