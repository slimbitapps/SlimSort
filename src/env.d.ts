declare module '*.css';
declare module '*?worker&inline' {
  const W: { new (): Worker };
  export default W;
}
