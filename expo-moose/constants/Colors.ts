/**
 * Below are the colors that are used in the app. The colors are defined in the light and dark mode.
 * There are many other ways to style your app. For example, [Nativewind](https://www.nativewind.dev/), [Tamagui](https://tamagui.dev/), [unistyles](https://reactnativeunistyles.vercel.app), etc.
 */

// Primary color palette
const primaryYellow = '#FFC107'; // Amber 500
const primaryOrange = '#FF9800'; // Orange 500
const primaryDarkOrange = '#F57C00'; // Orange 700

// Secondary and accent colors
const accentYellowLight = '#FFECB3'; // Amber 100
const accentOrangeDark = '#E65100'; // Orange 900
const textDark = '#212121'; // Gray 900
const textLight = '#FFFFFF'; // White

export const Colors = {
  light: {
    text: textDark,
    background: '#FFFBF0', // Very light yellow/cream
    tint: primaryOrange,
    icon: '#757575',
    tabIconDefault: '#BDBDBD',
    tabIconSelected: primaryOrange,
    cardBackground: '#FFFFFF',
    statusBarSuccess: '#4CAF50', // Green
    statusBarWarning: primaryOrange,
    statusBarError: '#F44336', // Red
    link: primaryDarkOrange,
    border: '#E0E0E0',
  },
  dark: {
    text: textLight,
    background: '#2D2D2D', // Dark gray
    tint: primaryYellow,
    icon: '#BDBDBD',
    tabIconDefault: '#757575',
    tabIconSelected: primaryYellow,
    cardBackground: '#3D3D3D',
    statusBarSuccess: '#81C784', // Light Green
    statusBarWarning: accentYellowLight,
    statusBarError: '#E57373', // Light Red
    link: accentYellowLight,
    border: '#424242',
  },
};
