import {cookies} from "next/headers";
import {redirect} from "next/navigation";
import {sessionActor} from "@/lib/security";
import {Simulator} from "@/components/simulator";

export const metadata={title:"Simulador del profesor · VidraCred"};
export default async function SimulatorPage() {
  const actor=await sessionActor((await cookies()).get("vidra_session")?.value);
  if(actor?.role!=="SISTEMA"&&!actor?.readOnly)redirect("/");
  return <Simulator guest={actor.readOnly}/>;
}
