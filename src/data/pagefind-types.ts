export type PagefindResult = {
  id: string;
  url: string;
  excerpt?: string;
  meta: { title?: string; subtitle?: string; thumb?: string; cardId?: string };
};

export type Pagefind = {
  search: (q: string) => Promise<{
    results: Array<{ id: string; data: () => Promise<PagefindResult> }>;
  }>;
};

declare global {
  interface Window {
    pagefind?: Pagefind;
  }
}
