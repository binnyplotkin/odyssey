/**
 * Odyssey Design System
 *
 * CSS imports (use in app globals.css):
 *   @import "@odyssey/ui/styles/base.css";
 *   @import "@odyssey/ui/styles/themes/forest.css";  -- or neutral.css
 *
 * Palette constants (for JS/TS when you need raw hex values):
 */

export { Sidebar } from "./components/sidebar";
export type { SidebarItem, SidebarAction, SidebarProps } from "./components/sidebar";

export const forest = {
  950: "#000500",
  900: "#0F2006",
  800: "#192922",
  700: "#2A4535",
  600: "#05473F",
  500: "#105A59",
  400: "#3A8B7A",
  300: "#8CE7D2",
  200: "#C7F7E5",
  100: "#E3FBF2",
  50: "#DBFDFF",
} as const;

export type ForestShade = keyof typeof forest;
