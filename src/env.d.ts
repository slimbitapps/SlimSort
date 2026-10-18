declare module '*.css';
declare module '*?worker&inline' {
  const W: { new (): Worker };
  export default W;
}
declare module '*.png' {
  const src: string;
  export default src;
}
