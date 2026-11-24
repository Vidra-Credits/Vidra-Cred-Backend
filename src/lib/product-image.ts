import sharp from "sharp";
import {RuleError} from "./finance";

export const MAX_IMAGE_BYTES=1024*1024;
export type ProductImage={data:Buffer;mime:"image/jpeg"|"image/png"|"image/webp"};
const formats={jpeg:"image/jpeg",png:"image/png",webp:"image/webp"} as const;

export async function readProductImage(file:File):Promise<ProductImage> {
  if(!file.size||file.size>MAX_IMAGE_BYTES)
    throw new RuleError("Suba una imagen de hasta 1 MB.","image",413);
  const data=Buffer.from(await file.arrayBuffer());
  const invalid=()=>new RuleError("Elija una imagen JPEG, PNG o WebP válida.","image");
  try {
    const image=sharp(data,{limitInputPixels:16_000_000});
    const {format}=await image.metadata();
    if(!format||!Object.hasOwn(formats,format))throw invalid();
    const mime=formats[format as keyof typeof formats];
    if(file.type&&file.type!=="application/octet-stream"&&file.type!==mime)throw invalid();
    await image.resize({width:32,withoutEnlargement:true}).toBuffer();
    return {data,mime};
  } catch {
    throw invalid();
  }
}
