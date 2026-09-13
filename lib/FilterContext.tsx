import { createContext, useContext, useState, type ReactNode } from 'react';

export type FilterState = {
  minAge:    number | null;
  dressCode: string | null;
  musicType: string | null;
  maxPrice:  number | null;
};

export const EMPTY_FILTERS: FilterState = {
  minAge: null, dressCode: null, musicType: null, maxPrice: null,
};

type FilterCtx = {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
};

const Ctx = createContext<FilterCtx>({
  filters: EMPTY_FILTERS,
  setFilters: () => {},
});

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  return <Ctx.Provider value={{ filters, setFilters }}>{children}</Ctx.Provider>;
}

export function useFilters() {
  return useContext(Ctx);
}
