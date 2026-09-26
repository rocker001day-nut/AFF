const {requireTeamMember}=require('./_lib/auth');
const {json,methodNotAllowed,fail}=require('./_lib/http');
module.exports=async(req,res)=>{
 if(req.method!=='GET') return methodNotAllowed(res,['GET']);
 try{
  const {supabase}=await requireTeamMember(req);
  const q=req.query||{};
  const from=q.from||null,to=q.to||null,platform=q.platform||null,account=q.account||null;
  const validDate=x=>!x||(typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!isNaN(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x);
  if(!validDate(from)||!validDate(to)||(from&&to&&from>to)||(platform&&!['shopee','lazada'].includes(platform))||(account&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(account))) return fail(res,400,'invalid_filters','ตรวจสอบช่วงวันที่และบัญชีที่เลือก');
  const {data,error}=await supabase.rpc('affiliate_dashboard',{p_from:from,p_to:to,p_platform:platform,p_account:account});
  if(error) throw error;
  return json(res,200,{ok:true,...data});
 }catch(e){return fail(res,e.statusCode||500,e.code||'dashboard_failed',e.message);}
};
