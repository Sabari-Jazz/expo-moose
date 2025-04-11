import { useColorScheme } from 'react-native';
import { Colors } from '@/constants/Colors';
import { useMemo } from 'react';

/**
 * A hook that provides access to the current theme colors and dark mode state
 * @returns An object containing isDarkMode flag and colors for the current theme
 */
export function useTheme() {
  const colorScheme = useColorScheme();
  const isDarkMode = colorScheme === 'dark';
  
  // Memoize the colors object to prevent unnecessary re-renders
  const colors = useMemo(() => {
    return {
      primary: isDarkMode ? Colors.dark.tint : Colors.light.tint,
      background: isDarkMode ? Colors.dark.background : Colors.light.background,
      text: isDarkMode ? Colors.dark.text : Colors.light.text,
      card: isDarkMode ? Colors.dark.cardBackground : Colors.light.cardBackground,
      border: isDarkMode ? Colors.dark.border : Colors.light.border,
      statusSuccess: isDarkMode ? Colors.dark.statusBarSuccess : Colors.light.statusBarSuccess,
      statusWarning: isDarkMode ? Colors.dark.statusBarWarning : Colors.light.statusBarWarning,
      statusError: isDarkMode ? Colors.dark.statusBarError : Colors.light.statusBarError,
      tabIconDefault: isDarkMode ? Colors.dark.tabIconDefault : Colors.light.tabIconDefault,
      tabIconSelected: isDarkMode ? Colors.dark.tabIconSelected : Colors.light.tabIconSelected,
      icon: isDarkMode ? Colors.dark.icon : Colors.light.icon,
      link: isDarkMode ? Colors.dark.link : Colors.light.link,
    };
  }, [isDarkMode]);

  return {
    isDarkMode,
    colors,
  };
} 