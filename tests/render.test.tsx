import {test} from "node:test";
import assert from "node:assert/strict";
import {renderToStaticMarkup} from "react-dom/server";
import {pool} from "../src/lib/db";
import {bootstrap} from "../src/lib/service";
import {actorFromRow} from "../src/lib/security";
import {IDS} from "../scripts/demo";
import {Login,Register,Catalog,Requests,Guide,Dashboard,Clients,Packages,Purchase,Simulator,Schedules,PaymentView,CutView,Portal,Stores,type Data} from "../src/components/workspace";

test("las vistas con datos PostgreSQL presentan recorridos y valores financieros",async()=>{
  try {
    async function actor(id:string) {
      return actorFromRow((await pool.query("SELECT * FROM users WHERE id=$1",[id])).rows[0]);
    }
    const data=await bootstrap(await actor(IDS.admin),IDS.store) as Data;
    const client=await bootstrap(await actor(IDS.customer)) as Data;
    const store=data.stores.find(s=>s.id===IDS.store)!;
    const historic=data.credits.find(c=>c.id===IDS.case2)!;
    const noop=()=>{},asyncNoop=async()=>{},refresh=asyncNoop,notify=noop,go=noop;
    const asOf="2026-09-26";
    const views=[
      [<Login onLogin={asyncNoop} connectionError={null}/>,"Iniciar sesión"],
      [<Register onDone={asyncNoop} onBack={noop}/>,"Crear cuenta de cliente"],
      [<Dashboard data={data} asOf={asOf} go={go}/>,"Nueva venta"],
      [<Clients data={data} asOf={asOf} refresh={refresh} notify={notify} go={go}/>,"Línea disponible"],
      [<Packages data={data} refresh={refresh} notify={notify}/>,"Al contado"],
      [<Purchase data={data} store={store} onDone={asyncNoop}/>,"Condiciones avanzadas"],
      [<Schedules data={data} asOf={asOf} selected={historic.id} go={go} refresh={refresh} notify={notify}/>,"Cronograma del crédito"],
      [<PaymentView credit={historic} number={10} onClose={noop} onDone={asyncNoop}/>,"Mora"],
      [<CutView data={data} asOf="2026-11-24" store={store} go={go}/>,"Corte mensual"],
      [<Portal data={client} asOf={asOf} go={go}/>,"Mis créditos"],
      [<Stores data={data} refresh={refresh} notify={notify} openStore={noop}/>,"Pago mensual"],
      [<Catalog data={client} refresh={refresh} notify={notify} go={go}/>,"Solicitar a crédito"],
      [<Requests data={client} refresh={refresh} notify={notify} go={go}/>,"Mis solicitudes"],
      [<Requests data={data} refresh={refresh} notify={notify} go={go}/>,"Solicitudes de compra"],
      [<Guide role="NEGOCIO" go={go}/>,"Prelación de pagos"],
      [<Simulator/>,"Cronograma editable"]
    ] as const;
    const html=views.map(([view,label])=>{
      const markup=renderToStaticMarkup(view);assert.ok(markup.includes(label),label);
      assert.doesNotMatch(markup,/>NaN<|>undefined</);
      return markup;
    });
    for(const text of ["728.53","4,515.16","Pago recibido","Días de atraso","Saldo inicial","TEQ","25.0000000"])
      assert.ok(html[6].includes(text),text);
    for(const label of ["Por cobrar en PEN","Por cobrar en USD","Intereses por mora"])
      assert.ok(html[8].includes(label),label);
    assert.doesNotMatch(html[10],/quincenal/i);
    for(const label of ["11 días","2,011.17","691.02","2026-10-26","2026-11-26","2026-12-26","TEM","Comparación de gracia","Fórmulas de la cuota 1","Cuota total"])
      assert.ok(html[15].includes(label),label);
    assert.ok(html[15].indexOf("Cronograma editable")<html[15].indexOf("Comparación de gracia"));
  } finally {await pool.end();}
});
