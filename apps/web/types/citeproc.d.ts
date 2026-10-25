// citeproc-js ships no type declarations. Only the parts Scriptorium uses.
declare module "citeproc" {
  interface Sys { retrieveLocale: (lang: string) => string; retrieveItem: (id: string) => unknown }
  interface Engine {
    setOutputFormat(format: "html" | "text" | "rtf"): void;
    updateItems(ids: string[]): void;
    processCitationCluster(citation: unknown, citationsPre: Array<[string, number]>, citationsPost: Array<[string, number]>): [unknown, Array<[number, string, string]>];
    makeBibliography(): [unknown, string[]];
  }
  const CSL: { Engine: new (sys: Sys, style: string, lang?: string, forceLang?: boolean) => Engine };
  export default CSL;
}
