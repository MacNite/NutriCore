import type { MetadataRoute } from "next";
export default function manifest():MetadataRoute.Manifest{return {name:"NutriCore",short_name:"NutriCore",description:"Privacy-first nutrition tracker",start_url:"/",display:"standalone",background_color:"#f5f7f2",theme_color:"#246b4b",icons:[{src:"/icon.svg",sizes:"any",type:"image/svg+xml"}]}}
