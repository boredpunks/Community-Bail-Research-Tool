import { useState } from 'react';

const KEY = 'cbr-standard-view';

export function applyStoredTheme() {
  const on = localStorage.getItem(KEY) === '1';
  document.documentElement.classList.toggle('standard', on);
  return on;
}

export function useStandardView() {
  const [standard, setStandard] = useState(() => applyStoredTheme());
  const toggle = () => {
    const next = !standard;
    localStorage.setItem(KEY, next ? '1' : '0');
    document.documentElement.classList.toggle('standard', next);
    setStandard(next);
  };
  return { standard, toggle };
}
