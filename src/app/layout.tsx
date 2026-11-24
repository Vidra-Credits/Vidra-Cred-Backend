import type {Metadata} from "next";
import "./globals.css";
export const metadata:Metadata={title:"VidraCred · Cuenta corriente comercial",description:"Catálogo, solicitudes de compra, créditos mensuales y cobranza para tiendas."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="es-PE"><body>{children}</body></html>;}
