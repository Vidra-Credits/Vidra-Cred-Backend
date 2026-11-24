import type {Compounding,Credit,Currency,Frequency} from "@/lib/finance";
import type {Actor} from "@/lib/security";
import type {QuoteSnapshot} from "@/lib/service";

export type StoreRow={id:string;name:string;business:string;ruc:string;cut_day:number;pay_day:number;active:boolean;admin_email?:string|null;admin_name?:string|null};
export type Approval="PENDIENTE"|"APROBADO"|"RECHAZADO";
export type ClientRow={
  id:string;store_id:string;name:string;document:string;phone:string;address:string;
  currency:Currency;tea:string;credit_limit:string;max_months:number;active:boolean;
  approval:Approval;approval_note:string;cut_day:number|null;pay_day:number|null;
  rate_kind:"TEA"|"TNA";rate_input:string|null;compounding:Compounding|null;
  mora_tea?:string;mora_kind?:"TEA"|"TNA";mora_input?:string|null;mora_compounding?:Compounding|null;
};
export type ProductMode="UNICO"|"CUOTAS"|"AMBOS";
export type PackageRow={
  id:string;store_id:string;name:string;detail:string;currency:Currency;amount:string;active:boolean;
  image:string|null;brand:string;supplier:string;unit:string;cash_price:string;sale_mode:ProductMode;
};
export type RequestRow={
  id:string;client_id:string;package_id:string;purchase_date:string;months:number;mode:"CUOTAS"|"UNICO";
  frequency:Frequency;grace:string;status:"PENDIENTE"|"APROBADA"|"RECHAZADA"|"CANCELADA";
  credit_id:string|null;note:string;created_at:string;resolved_at:string|null;client_name:string;
  package_name:string;amount:string;currency:Currency;review_issue:string|null;quote_snapshot:QuoteSnapshot|null;
};
export type Data={actor:Actor;storeId:string|null;stores:StoreRow[];clients:ClientRow[];packages:PackageRow[];credits:Credit[];requests:RequestRow[]};
export type View="panel"|"clientes"|"paquetes"|"compra"|"simulador"|"cronograma"|"pagos"|"corte"|"portal"|"tiendas"|"catalogo"|"solicitudes"|"guia";
export type Go=(view:View,id?:string)=>void;
export type Refresh=()=>Promise<unknown>;
export type Notify=(message:string)=>void;
export const saleModeLabels:Record<ProductMode,string>={CUOTAS:"Cuotas mensuales",UNICO:"Pago único",AMBOS:"Pago único o cuotas"};
export const compoundingLabels:Record<Compounding,string>={
  DIARIA:"Diaria (360)",QUINCENAL:"Quincenal (24)",MENSUAL:"Mensual (12)",BIMESTRAL:"Bimestral (6)",
  TRIMESTRAL:"Trimestral (4)",SEMESTRAL:"Semestral (2)",ANUAL:"Anual (1)"
};
