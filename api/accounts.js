const { requireTeamMember } = require('./_lib/auth');
const { json, methodNotAllowed, fail } = require('./_lib/http');
module.exports = async (req,res) => {
 if (!['GET','POST'].includes(req.method)) return methodNotAllowed(res,['GET','POST']);
 try {
  const {supabase,user,member}=await requireTeamMember(req);
  if(req.method==='GET') {
   const {data,error}=await supabase.from('affiliate_accounts').select('id,platform,label,external_account_id').order('label');
   if(error) throw error;
   return json(res,200,{ok:true,accounts:data});
  }
  if(member.role!=='owner') return fail(res,403,'owner_required','เฉพาะเจ้าของทีมสามารถเพิ่มบัญชีได้');
  const body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  const platform=String(body.platform||''), label=String(body.label||'').trim(), external=String(body.external_account_id||'').trim();
  if(!['shopee','lazada'].includes(platform)||!label||label.length>80||!external||external.length>120) return fail(res,400,'invalid_account','กรอกแพลตฟอร์ม ชื่อบัญชี และรหัสบัญชีให้ครบ');
  const {data,error}=await supabase.from('affiliate_accounts').insert({platform,label,external_account_id:external,created_by:user.id}).select('id,platform,label,external_account_id').single();
  if(error?.code==='23505') return fail(res,409,'duplicate_account','มีรหัสบัญชีนี้ในแพลตฟอร์มเดียวกันแล้ว');
  if(error) throw error;
  return json(res,201,{ok:true,account:data});
 }catch(e){return fail(res,e.statusCode||500,e.code||'accounts_failed',e.message);}
};
