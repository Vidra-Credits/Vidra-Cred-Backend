import { D, type Currency } from "./finance";
const sources={circular:"https://www.bcrp.gob.pe/docs/Transparencia/Normas-Legales/Circulares/2021/circular-0008-2021-bcrp.pdf",sbs:"https://intranet2.sbs.gob.pe/dv_int_cn/1731/v3.0/adjuntos/3274-2017.r.pdf"};
export const LEGAL_REFERENCES = [
  {from:"2025-11-01",to:"2026-04-30",PEN:"1.1316",USD:"0.9540",source:"https://www.bcrp.gob.pe/docs/Transparencia/Notas-Informativas/2025/nota-informativa-2025-10-09-2.pdf"},
  {from:"2026-05-01",to:"2026-10-31",PEN:"1.1413",USD:"0.9984",source:"https://www.bcrp.gob.pe/docs/Transparencia/Notas-Informativas/2026/nota-informativa-2026-04-07.pdf"}
];
export function legalReference(date:string,currency:Currency) {
  const ref=LEGAL_REFERENCES.find(r=>r.from<=date&&r.to>=date);
  return ref?{from:ref.from,to:ref.to,compensatory:ref[currency],moratory:new D(ref[currency]).mul("0.15").toFixed(6),source:ref.source,...sources}:null;
}
