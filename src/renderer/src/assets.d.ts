/**
 * Vite resolves image imports to a URL string. TypeScript needs telling.
 */
declare module '*.png' {
  const src: string
  export default src
}
