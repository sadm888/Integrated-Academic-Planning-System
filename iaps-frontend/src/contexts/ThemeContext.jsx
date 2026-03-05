import React, { createContext, useContext, useState, useEffect } from 'react';

const ThemeContext = createContext();

const themeKey = (userId) => userId ? `theme_${userId}` : 'theme_guest';

export function ThemeProvider({ userId, children }) {
  const [theme, setTheme] = useState(() => localStorage.getItem(themeKey(userId)) || 'light');

  // When the logged-in user changes, load their saved preference
  useEffect(() => {
    const saved = localStorage.getItem(themeKey(userId)) || 'light';
    setTheme(saved);
  }, [userId]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(themeKey(userId), theme);
  }, [theme, userId]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
