declare module '*.css';
declare module '*?worker&inline' {
  const W: { new (): Worker };
  export default W;
}
declare module '*.png' {
  const src: string;
  export default src;
}
declare module '*?worker' {
  const W: { new (): Worker };
  export default W;
}
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  const factory: (opts?: object) => Promise<any>;
  export default factory;
}
