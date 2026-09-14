import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * True only after the client has hydrated - for anything that must render
 * one way during SSR/first paint and can only know the real answer
 * client-side (e.g. the active theme, which next-themes resolves from
 * localStorage). useSyncExternalStore's getServerSnapshot/getSnapshot split
 * gives this without ever calling setState from an effect, unlike the
 * common `useState(false) + useEffect(() => setState(true), [])` idiom.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
