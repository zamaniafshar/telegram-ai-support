import { useEffect } from 'react';

export interface TelegramWebApp {
  initData: string;
  colorScheme: 'light' | 'dark';
  ready(): void;
  expand(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  enableClosingConfirmation?(): void;
  disableClosingConfirmation?(): void;
  openTelegramLink?(url: string): void;
  onEvent?(event: string, listener: () => void): void;
  offEvent?(event: string, listener: () => void): void;
  BackButton?: {
    show(): void;
    hide(): void;
    onClick(listener: () => void): void;
    offClick(listener: () => void): void;
  };
  MainButton?: {
    setText(value: string): void;
    show(): void;
    hide(): void;
    onClick(listener: () => void): void;
    offClick(listener: () => void): void;
  };
  HapticFeedback?: {
    notificationOccurred(type: 'success' | 'warning' | 'error'): void;
    selectionChanged(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export const telegram = window.Telegram?.WebApp;

export function initializeTelegram(): void {
  telegram?.ready();
  telegram?.expand();
}

export function useTelegramMainButton(label: string, onClick: () => void, visible = true): void {
  useEffect(() => {
    const button = telegram?.MainButton;
    if (!button || !visible) return;
    button.setText(label);
    button.show();
    button.onClick(onClick);
    return () => {
      button.offClick(onClick);
      button.hide();
    };
  }, [label, onClick, visible]);
}
