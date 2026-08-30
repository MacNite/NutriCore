import "./globals.css";
import type { Metadata, Viewport } from "next";
export const metadata:Metadata={title:"NutriCore",description:"Private nutrition, clearly sourced",manifest:"/manifest.webmanifest",icons:{icon:"/icon.svg"}};
export const viewport:Viewport={themeColor:"#246b4b",width:"device-width",initialScale:1};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="de"><body>{children}</body></html>}
