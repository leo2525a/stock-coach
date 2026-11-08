import { useStore } from '../store';

/**
 * Explicitly take a symbol to the chart.
 *
 * N2 guard: this is the *only* way the mover strip changes the headline symbol.
 * A casual tap on a tile must not slide the top-bar ticker/price away from the
 * chart on screen, so selection lives on a dedicated, labelled control and
 * always lands the user on the chart screen for that symbol.
 */
export function useRevealSymbol(): (symbol: string) => void {
  const selectSymbol = useStore((s) => s.selectSymbol);
  const setScreen = useStore((s) => s.setScreen);
  return (symbol: string) => {
    selectSymbol(symbol);
    setScreen('chart');
  };
}
