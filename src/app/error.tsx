"use client";
export default function ErrorPage({reset}:{reset:()=>void}){return <main className="loading"><h1>No se pudo cargar esta vista</h1><button className="primary" onClick={reset}>Reintentar</button></main>;}
