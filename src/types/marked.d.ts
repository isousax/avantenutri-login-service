declare module 'marked' {
  export function parse(md: string): string;
  export { parse as marked };
}
