// Allow Vite `?raw` imports of template files (C#, Dockerfile, yml, etc.) to be
// typed as strings in the main-process build (tsconfig.node.json has no vite/client types).
declare module '*?raw' {
  const content: string;
  export default content;
}
