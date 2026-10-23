
export async function onRequestGet({request,env}) {
  const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
  try {
    if(!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) return reply({error:'Serverconfiguratie ontbreekt',code:'CONFIG_MISSING'},503);
    const u=new URL(request.url),from=u.searchParams.get('from'),to=u.searchParams.get('to');
    const valid=x=>/^\d{4}-\d{2}-\d{2}$/.test(x||'') && !Number.isNaN(Date.parse(x+'T00:00:00Z'));
    if(!valid(from)||!valid(to)||from>=to) return reply({error:'Ongeldige datum',code:'DATE_INVALID'},400);
    const base=env.SUPABASE_URL.replace(/\/+(rest\/v1)?\/?$/,'');
    const headers={apikey:env.SUPABASE_ANON_KEY||env.SUPABASE_SERVICE_ROLE_KEY,Authorization:'Bearer '+env.SUPABASE_SERVICE_ROLE_KEY};
    const get=async (table,path)=>{
      let r;
      try {r=await fetch(base+'/rest/v1/'+path,{headers});}
      catch(e){throw {code:'NETWORK_'+table,status:502};}
      if(!r.ok) {console.error('Supabase request failed',table,r.status,(await r.text()).slice(0,600));throw {code:'SUPABASE_'+table+'_'+r.status,status:502};}
      return r.json();
    };
    const slots=await get('SLOTS',`lesson_slots?select=id,date,start_time,duration_minutes,max_children&date=gte.${from}&date=lt.${to}&order=date.asc,start_time.asc`);
    const bookings=await get('BOOKINGS',`bookings?select=slot_id,child_count,location,status&status=eq.bevestigd&lesson_date=gte.${from}&lesson_date=lt.${to}`);
    const booked=new Map();for(const b of bookings){const x=booked.get(b.slot_id)||{count:0,home:false};x.count+=Number(b.child_count)||0;x.home ||=b.location==='thuis';booked.set(b.slot_id,x)}
    const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    const active=slots.filter(s=>s.date>=today).filter(s=>{const b=booked.get(s.id);return !b||(!b.home&&b.count<s.max_children)}).filter(s=>{
      const start=Date.parse(s.date+'T'+s.start_time),end=start+s.duration_minutes*60000;
      return !slots.some(o=>o.id!==s.id&&(booked.get(o.id)?.count||0)>0&&start<Date.parse(o.date+'T'+o.start_time)+o.duration_minutes*60000&&Date.parse(o.date+'T'+o.start_time)<end);
    }).map(s=>({...s,remaining:s.max_children-(booked.get(s.id)?.count||0)}));
    return reply(active);
  }catch(e){console.error('Availability failure',e);return reply({error:'Agenda tijdelijk niet beschikbaar',code:e?.code||'UNEXPECTED'},e?.status||500)}
}
